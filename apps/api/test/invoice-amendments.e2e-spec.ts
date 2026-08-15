import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { OpeningBalancesService } from '../src/modules/inventory/opening-balances.service';
import { InventoryMovementsService } from '../src/modules/inventory/inventory-movements.service';
import { JewelryItemsService } from '../src/modules/inventory/jewelry-items.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { InvoiceAmendmentsService } from '../src/modules/sales/invoice-amendments.service';
import { JewelryCreditSalesService } from '../src/modules/sales/jewelry-credit-sales.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
  auditLogs,
  inventoryMovements,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  salesInvoiceVersions,
  salesInvoices,
  tenants,
} from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { UserService } from '../src/platform/users/user.service';
import type { Database } from '../src/platform/database/connect';
import type { INestApplicationContext } from '@nestjs/common';

describe('sales invoice amendments (BE-054)', () => {
  const tenant = { id: '', slug: `invoice-amendment-${randomUUID().slice(0, 12)}` };
  let app: INestApplicationContext;
  let db: Database;
  let amendments: InvoiceAmendmentsService;
  let creditSales: JewelryCreditSalesService;
  let movements: InventoryMovementsService;
  let actorUserId = '';
  let originalPartyId = '';
  let correctedPartyId = '';
  let originalItemId = '';
  let correctedItemId = '';
  let unstockedItemId = '';
  let quoteId = '';
  let invoiceId = '';
  let effectiveAt: Date;
  let amendmentVersionId = '';
  let amendedPayableRial = 0n;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
    amendments = app.get(InvoiceAmendmentsService);
    creditSales = app.get(JewelryCreditSalesService);
    movements = app.get(InventoryMovementsService);
    const tenantService = app.get(TenantService);
    const users = app.get(UserService);
    const parties = app.get(PartiesService);
    const items = app.get(JewelryItemsService);
    const quotes = app.get(PriceQuotesService);
    const opening = app.get(OpeningBalancesService);

    tenant.id = (
      await tenantService.create({ name: 'Invoice amendment tenant', slug: tenant.slug })
    ).id;
    actorUserId = (
      await users.create({
        email: `${randomUUID().slice(0, 12)}@example.com`,
        displayName: 'Invoice amendment actor',
      })
    ).id;
    [originalPartyId, correctedPartyId] = await withTenantTransaction(
      db,
      tenant.id,
      async (transaction) => {
        const original = await parties.createInTransaction(transaction, {
          tenantId: tenant.id,
          actorUserId,
          input: { type: 'CONSUMER', displayName: 'Original party' },
        });
        const corrected = await parties.createInTransaction(transaction, {
          tenantId: tenant.id,
          actorUserId,
          input: { type: 'CONSUMER', displayName: 'Corrected party' },
        });
        return [original.id, corrected.id];
      },
    );
    effectiveAt = new Date();
    originalItemId = (
      await items.createItem({
        tenantId: tenant.id,
        code: `AMEND-OLD-${randomUUID().slice(0, 8)}`,
        title: 'Original ring',
        grossWeightMg: 12_000n,
        karat: 750,
        stoneWeightMg: 2_000n,
        otherDeductionWeightMg: 0n,
        wageType: 'PER_GRAM',
        wageValue: 350_000n,
        validFrom: effectiveAt,
        active: true,
      })
    ).jewelryItemId;
    correctedItemId = (
      await items.createItem({
        tenantId: tenant.id,
        code: `AMEND-NEW-${randomUUID().slice(0, 8)}`,
        title: 'Corrected ring',
        grossWeightMg: 8_000n,
        karat: 750,
        stoneWeightMg: 0n,
        otherDeductionWeightMg: 0n,
        wageType: 'PER_GRAM',
        wageValue: 350_000n,
        validFrom: effectiveAt,
        active: true,
      })
    ).jewelryItemId;
    unstockedItemId = (
      await items.createItem({
        tenantId: tenant.id,
        code: `AMEND-FAIL-${randomUUID().slice(0, 8)}`,
        title: 'Unstocked corrected ring',
        grossWeightMg: 7_000n,
        karat: 750,
        stoneWeightMg: 0n,
        otherDeductionWeightMg: 0n,
        wageType: 'PER_GRAM',
        wageValue: 350_000n,
        validFrom: effectiveAt,
        active: true,
      })
    ).jewelryItemId;
    quoteId = (
      await quotes.createManual({
        tenantId: tenant.id,
        quoteType: 'MAZNEH',
        amountRial: 100_000_000n,
        createdBy: actorUserId,
      })
    ).id;
    await withTenantTransaction(db, tenant.id, (transaction) =>
      opening.createInTransaction(transaction, {
        tenantId: tenant.id,
        effectiveAt,
        description: 'Opening stock for amendments',
        createdBy: actorUserId,
        lines: [
          { itemType: 'JEWELRY', itemId: originalItemId, quantity: 1n },
          { itemType: 'JEWELRY', itemId: correctedItemId, quantity: 1n },
        ],
      }),
    );
    const sale = await withTenantTransaction(db, tenant.id, (transaction) =>
      creditSales.createInTransaction(transaction, {
        tenantId: tenant.id,
        partyId: originalPartyId,
        jewelryItemId: originalItemId,
        quoteId,
        effectiveAt,
        paidRial: 0n,
        createdBy: actorUserId,
      }),
    );
    invoiceId = sale.invoiceId;
  });

  afterAll(async () => {
    if (tenant.id !== '') {
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    }
    await app.close();
  });

  it('preserves version 1, creates version 2 with the same invoice number, and posts only the calculated difference', async () => {
    const amended = await amendments.amend({
      tenantId: tenant.id,
      salesInvoiceId: invoiceId,
      input: {
        reason: 'PARTY_ERROR',
        partyId: correctedPartyId,
        item: { itemType: 'JEWELRY', jewelryItemId: correctedItemId, paidRial: '0' },
      },
      actorUserId,
      actorRole: 'MANAGER',
      amendedAt: new Date(),
    });
    amendedPayableRial = amended.payableRial;
    amendmentVersionId = (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        transaction
          .select({ id: salesInvoiceVersions.id })
          .from(salesInvoiceVersions)
          .where(
            and(
              eq(salesInvoiceVersions.salesInvoiceId, invoiceId),
              eq(salesInvoiceVersions.version, 2),
            ),
          )
          .limit(1),
      )
    )[0]!.id;

    const state = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      invoice: await transaction
        .select()
        .from(salesInvoices)
        .where(eq(salesInvoices.id, invoiceId))
        .limit(1),
      versions: await transaction
        .select()
        .from(salesInvoiceVersions)
        .where(eq(salesInvoiceVersions.salesInvoiceId, invoiceId))
        .orderBy(salesInvoiceVersions.version),
      amendmentLedger: await transaction
        .select()
        .from(ledgerTransactions)
        .where(
          and(
            eq(ledgerTransactions.tenantId, tenant.id),
            eq(ledgerTransactions.sourceType, 'SALES_INVOICE_AMENDMENT'),
          ),
        ),
      amendmentEntries: await transaction
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.tenantId, tenant.id)),
      audit: await transaction
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.tenantId, tenant.id), eq(auditLogs.action, 'SALES_INVOICE_AMENDED')),
        ),
    }));

    expect(amended).toMatchObject({ invoiceId, version: 2, receivableRial: amended.payableRial });
    expect(state.invoice[0]).toMatchObject({
      invoiceNumber: 1,
      currentVersion: 2,
      partyId: correctedPartyId,
    });
    expect(state.versions).toHaveLength(2);
    expect(state.versions[0]).toMatchObject({ version: 1, partyId: originalPartyId, reason: null });
    expect(state.versions[1]).toMatchObject({
      version: 2,
      partyId: correctedPartyId,
      reason: 'PARTY_ERROR',
    });
    expect(state.amendmentLedger).toHaveLength(1);
    const amendmentEntryTotal = state.amendmentEntries
      .filter((entry) => entry.transactionId === state.amendmentLedger[0]!.id)
      .reduce((total, entry) => total + entry.quantity, 0n);
    expect(amendmentEntryTotal).toBe(0n);
    expect(state.audit).toHaveLength(1);
    expect(await movements.balance(tenant.id, 'JEWELRY', originalItemId)).toBe(1n);
    expect(await movements.balance(tenant.id, 'JEWELRY', correctedItemId)).toBe(0n);
    expect(
      await withTenantTransaction(db, tenant.id, (transaction) =>
        transaction
          .select()
          .from(inventoryMovements)
          .where(
            and(
              eq(inventoryMovements.tenantId, tenant.id),
              eq(inventoryMovements.sourceType, 'CORRECTION'),
              eq(inventoryMovements.sourceId, amendmentVersionId),
            ),
          ),
      ),
    ).toHaveLength(2);

    const [correctedReceivable] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.tenantId, tenant.id),
            eq(ledgerAccounts.partyId, correctedPartyId),
            eq(ledgerAccounts.accountType, 'ASSET'),
          ),
        )
        .limit(1),
    );
    const correctedBalance = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.accountId, correctedReceivable!.id)),
    );
    expect(correctedBalance.reduce((total, entry) => total + entry.quantity, 0n)).toBe(
      amendedPayableRial,
    );
  });

  it('rolls every amendment write back when the differential inventory movement cannot be recorded', async () => {
    const before = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      invoice: await transaction
        .select({ currentVersion: salesInvoices.currentVersion })
        .from(salesInvoices)
        .where(eq(salesInvoices.id, invoiceId))
        .limit(1),
      versions: await transaction
        .select({ id: salesInvoiceVersions.id })
        .from(salesInvoiceVersions)
        .where(eq(salesInvoiceVersions.salesInvoiceId, invoiceId)),
      amendments: await transaction
        .select({ id: ledgerTransactions.id })
        .from(ledgerTransactions)
        .where(
          and(
            eq(ledgerTransactions.tenantId, tenant.id),
            eq(ledgerTransactions.sourceType, 'SALES_INVOICE_AMENDMENT'),
          ),
        ),
    }));

    await expect(
      amendments.amend({
        tenantId: tenant.id,
        salesInvoiceId: invoiceId,
        input: {
          reason: 'WEIGHT_ERROR',
          partyId: correctedPartyId,
          item: { itemType: 'JEWELRY', jewelryItemId: unstockedItemId, paidRial: '0' },
        },
        actorUserId,
        actorRole: 'MANAGER',
        amendedAt: new Date(),
      }),
    ).rejects.toThrow();

    const after = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      invoice: await transaction
        .select({ currentVersion: salesInvoices.currentVersion })
        .from(salesInvoices)
        .where(eq(salesInvoices.id, invoiceId))
        .limit(1),
      versions: await transaction
        .select({ id: salesInvoiceVersions.id })
        .from(salesInvoiceVersions)
        .where(eq(salesInvoiceVersions.salesInvoiceId, invoiceId)),
      amendments: await transaction
        .select({ id: ledgerTransactions.id })
        .from(ledgerTransactions)
        .where(
          and(
            eq(ledgerTransactions.tenantId, tenant.id),
            eq(ledgerTransactions.sourceType, 'SALES_INVOICE_AMENDMENT'),
          ),
        ),
    }));
    expect(after).toEqual(before);
    expect(await movements.balance(tenant.id, 'JEWELRY', unstockedItemId)).toBe(0n);
  });
});
