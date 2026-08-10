import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
  salesInvoiceItems,
  salesInvoiceVersions,
  salesInvoices,
  tenants,
} from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { UserService } from '../src/platform/users/user.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { SalesInvoicesService } from '../src/modules/sales/sales-invoices.service';
import {
  SalesInvoiceNotDraftError,
  SalesInvoiceQuoteNotFoundError,
} from '../src/modules/sales/sales-invoices.errors';
import type { Database } from '../src/platform/database/connect';
import type { INestApplicationContext } from '@nestjs/common';

describe('versioned sales invoices (BE-039)', () => {
  const tenant = { id: '', slug: `sales-invoice-${randomUUID().slice(0, 12)}` };
  let app: INestApplicationContext;
  let db: Database;
  let tenantService: TenantService;
  let users: UserService;
  let parties: PartiesService;
  let quotes: PriceQuotesService;
  let invoices: SalesInvoicesService;
  let partyId = '';
  let quoteId = '';
  let actorUserId = '';
  const effectiveAt = new Date('2026-08-10T09:00:00Z');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
    tenantService = app.get(TenantService);
    users = app.get(UserService);
    parties = app.get(PartiesService);
    quotes = app.get(PriceQuotesService);
    invoices = app.get(SalesInvoicesService);

    tenant.id = (
      await tenantService.create({ name: 'Sales invoice tenant', slug: tenant.slug })
    ).id;
    actorUserId = (
      await users.create({
        email: `${randomUUID().slice(0, 12)}@example.com`,
        displayName: 'Sales invoice actor',
      })
    ).id;
    const party = await withTenantTransaction(db, tenant.id, (transaction) =>
      parties.createInTransaction(transaction, {
        tenantId: tenant.id,
        actorUserId,
        input: { type: 'CONSUMER', displayName: 'خریدار فاکتور' },
      }),
    );
    partyId = party.id;
    const quote = await quotes.createManual({
      tenantId: tenant.id,
      quoteType: 'MAZNEH',
      amountRial: 1_234_567_890n,
      createdBy: actorUserId,
    });
    quoteId = quote.id;
  });

  afterAll(async () => {
    if (tenant.id !== '') {
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    }
    await app.close();
  });

  it('creates a draft, then a finalized immutable version with locked quote snapshots', async () => {
    const draft = await invoices.createDraft({
      tenantId: tenant.id,
      partyId,
      createdBy: actorUserId,
    });
    expect(draft).toMatchObject({ status: 'DRAFT', invoiceNumber: null, currentVersion: 0 });

    const finalized = await invoices.finalize({
      tenantId: tenant.id,
      salesInvoiceId: draft.id,
      effectiveAt,
      quoteId,
      quoteAmountRial: 1_234_567_890n,
      quoteObservedAt: (await quotes.latest(tenant.id, 'MAZNEH'))!.observedAt,
      totalsSnapshot: { goldMg: '7500', payableRial: '1234567890' },
      settingsSnapshot: { taxRatePermille: '90', roundingUnitRial: '1000' },
      items: [
        {
          itemType: 'JEWELRY',
          itemId: randomUUID(),
          quantity: 1,
          lineSnapshot: { pureWeightMg: '7500', finalRial: '1234567890' },
        },
      ],
      createdBy: actorUserId,
    });

    expect(finalized.invoice).toMatchObject({ status: 'FINALIZED', currentVersion: 1 });
    expect(finalized.invoice.invoiceNumber).toBe(1);
    expect(finalized.version).toMatchObject({
      version: 1,
      totalsSnapshot: { goldMg: '7500', payableRial: '1234567890' },
    });
    expect(finalized.items).toHaveLength(1);

    const rows = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      invoices: await transaction
        .select()
        .from(salesInvoices)
        .where(eq(salesInvoices.id, draft.id)),
      versions: await transaction
        .select()
        .from(salesInvoiceVersions)
        .where(eq(salesInvoiceVersions.salesInvoiceId, draft.id)),
      items: await transaction
        .select()
        .from(salesInvoiceItems)
        .where(eq(salesInvoiceItems.salesInvoiceId, draft.id)),
    }));
    expect(rows.invoices).toHaveLength(1);
    expect(rows.versions).toHaveLength(1);
    expect(rows.items).toHaveLength(1);

    await expect(
      invoices.finalize({
        tenantId: tenant.id,
        salesInvoiceId: draft.id,
        effectiveAt,
        quoteId,
        quoteAmountRial: 1_234_567_890n,
        quoteObservedAt: finalized.invoice.quoteObservedAt!,
        totalsSnapshot: { payableRial: '1234567890' },
        settingsSnapshot: { taxRatePermille: '90' },
        items: [
          { itemType: 'COIN', itemId: randomUUID(), quantity: 1, lineSnapshot: { count: '1' } },
        ],
        createdBy: actorUserId,
      }),
    ).rejects.toBeInstanceOf(SalesInvoiceNotDraftError);
  });

  it('rejects a quote snapshot that does not belong to the source quote', async () => {
    const draft = await invoices.createDraft({
      tenantId: tenant.id,
      partyId,
      createdBy: actorUserId,
    });
    await expect(
      invoices.finalize({
        tenantId: tenant.id,
        salesInvoiceId: draft.id,
        effectiveAt,
        quoteId,
        quoteAmountRial: 1n,
        quoteObservedAt: effectiveAt,
        totalsSnapshot: { payableRial: '1' },
        settingsSnapshot: { taxRatePermille: '0' },
        items: [
          { itemType: 'COIN', itemId: randomUUID(), quantity: 1, lineSnapshot: { count: '1' } },
        ],
        createdBy: actorUserId,
      }),
    ).rejects.toBeInstanceOf(SalesInvoiceQuoteNotFoundError);
  });

  it('database blocks rewriting a version or a finalized invoice number', async () => {
    const [invoice] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(salesInvoices)
        .where(and(eq(salesInvoices.tenantId, tenant.id), eq(salesInvoices.status, 'FINALIZED')))
        .limit(1),
    );
    const [version] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(salesInvoiceVersions)
        .where(eq(salesInvoiceVersions.salesInvoiceId, invoice!.id))
        .limit(1),
    );

    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        transaction
          .update(salesInvoices)
          .set({ invoiceNumber: 99 })
          .where(eq(salesInvoices.id, invoice!.id)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        transaction
          .update(salesInvoiceVersions)
          .set({ reason: 'rewrite' })
          .where(eq(salesInvoiceVersions.id, version!.id)),
      ),
    ).rejects.toThrow();
  });
});
