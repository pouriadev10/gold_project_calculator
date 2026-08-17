import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
  priceQuotes,
  salesInvoices,
  secondHandPurchaseItems,
  secondHandPurchases,
  tenants,
} from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { PartiesService } from '../src/modules/parties/parties.service';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { UserService } from '../src/platform/users/user.service';
import type { Database } from '../src/platform/database/connect';
import type { INestApplicationContext } from '@nestjs/common';

describe('second-hand purchase data model (BE-049)', () => {
  const tenant = { id: '', slug: `second-hand-${randomUUID().slice(0, 12)}` };
  const otherTenant = { id: '', slug: `second-hand-other-${randomUUID().slice(0, 12)}` };
  let app: INestApplicationContext;
  let db: Database;
  let tenantService: TenantService;
  let users: UserService;
  let parties: PartiesService;
  let quotes: PriceQuotesService;
  let actorUserId = '';
  let partyId = '';
  let otherPartyId = '';
  let quoteId = '';
  let effectiveAt = new Date();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
    tenantService = app.get(TenantService);
    users = app.get(UserService);
    parties = app.get(PartiesService);
    quotes = app.get(PriceQuotesService);

    tenant.id = (await tenantService.create({ name: 'Second-hand tenant', slug: tenant.slug })).id;
    otherTenant.id = (
      await tenantService.create({ name: 'Other second-hand tenant', slug: otherTenant.slug })
    ).id;
    effectiveAt = new Date();
    actorUserId = (
      await users.create({
        email: `${randomUUID().slice(0, 12)}@example.com`,
        displayName: 'Second-hand actor',
      })
    ).id;
    partyId = (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        parties.createInTransaction(transaction, {
          tenantId: tenant.id,
          actorUserId,
          input: { type: 'CONSUMER', displayName: 'Seller' },
        }),
      )
    ).id;
    otherPartyId = (
      await withTenantTransaction(db, otherTenant.id, (transaction) =>
        parties.createInTransaction(transaction, {
          tenantId: otherTenant.id,
          actorUserId,
          input: { type: 'CONSUMER', displayName: 'Other seller' },
        }),
      )
    ).id;
    quoteId = (
      await quotes.createManual({
        tenantId: tenant.id,
        quoteType: 'MAZNEH',
        amountRial: 1_000_000_000n,
        createdBy: actorUserId,
      })
    ).id;
  });

  afterAll(async () => {
    if (tenant.id !== '') await db.delete(tenants).where(eq(tenants.id, tenant.id));
    if (otherTenant.id !== '') await db.delete(tenants).where(eq(tenants.id, otherTenant.id));
    await app.close();
  });

  async function insertPurchase(sourceInvoiceId: string | null = null) {
    return withTenantTransaction(db, tenant.id, async (transaction) => {
      const [quote] = await transaction
        .select()
        .from(priceQuotes)
        .where(and(eq(priceQuotes.tenantId, tenant.id), eq(priceQuotes.id, quoteId)))
        .limit(1);
      const [purchase] = await transaction
        .insert(secondHandPurchases)
        .values({
          tenantId: tenant.id,
          partyId,
          sourceInvoiceId,
          lockedQuoteId: quoteId,
          lockedQuoteAmountRial: quote!.amountRial,
          lockedQuoteObservedAt: quote!.observedAt,
          settingsSnapshot: {
            defaultPurchaseKarat: '740',
            baseQuoteKarat: '705',
            mithqalGrams: '4.6083',
            roundingUnitRial: '1000',
            roundingPolicy: 'HALF_UP',
          },
          sellerIdentitySnapshot: { displayName: 'Seller', nationalId: null, mobile: null },
          feeRial: 25_000n,
          finalAmountRial: 48_500_000n,
          effectiveAt,
          finalizedAt: new Date(),
          createdBy: actorUserId,
        })
        .returning();
      const [item] = await transaction
        .insert(secondHandPurchaseItems)
        .values({
          tenantId: tenant.id,
          secondHandPurchaseId: purchase!.id,
          itemType: 'GOLD',
          grossWeightMg: 1_000n,
          stoneWeightMg: 100n,
          otherDeductionWeightMg: 0n,
          purchaseKarat: 740,
          pureWeightMg: 666n,
          itemSnapshot: { grossWeightMg: '1000', pureWeightMg: '666' },
        })
        .returning();

      return { purchase: purchase!, item: item! };
    });
  }

  it('persists all B2C-purchase snapshots with a nullable source invoice and melted-gold default', async () => {
    const { purchase, item } = await insertPurchase();

    expect(purchase.sourceInvoiceId).toBeNull();
    expect(purchase.lockedQuoteAmountRial).toBe(1_000_000_000n);
    expect(purchase.settingsSnapshot).toMatchObject({ defaultPurchaseKarat: '740' });
    expect(purchase.sellerIdentitySnapshot).toMatchObject({ displayName: 'Seller' });
    expect(purchase).not.toHaveProperty('originalWageRial');
    expect(item).toMatchObject({
      itemType: 'GOLD',
      destinationInventoryType: 'MELTED_GOLD',
      grossWeightMg: 1_000n,
      stoneWeightMg: 100n,
      otherDeductionWeightMg: 0n,
      purchaseKarat: 740,
      pureWeightMg: 666n,
      coinTypeId: null,
      coinCount: null,
    });
  });

  it('can link a purchase to a same-tenant source invoice without changing that invoice', async () => {
    const [sourceInvoice] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .insert(salesInvoices)
        .values({ tenantId: tenant.id, partyId, createdBy: actorUserId })
        .returning(),
    );
    const { purchase } = await insertPurchase(sourceInvoice!.id);

    expect(purchase.sourceInvoiceId).toBe(sourceInvoice!.id);
    const [unchanged] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select({ status: salesInvoices.status, currentVersion: salesInvoices.currentVersion })
        .from(salesInvoices)
        .where(eq(salesInvoices.id, sourceInvoice!.id))
        .limit(1),
    );
    expect(unchanged).toEqual({ status: 'DRAFT', currentVersion: 0 });
  });

  it('keeps tenant boundaries and the no-coin-weight invariant at the database layer', async () => {
    const [otherInvoice] = await withTenantTransaction(db, otherTenant.id, (transaction) =>
      transaction
        .insert(salesInvoices)
        .values({ tenantId: otherTenant.id, partyId: otherPartyId, createdBy: actorUserId })
        .returning(),
    );

    await expect(insertPurchase(otherInvoice!.id)).rejects.toThrow();

    const { purchase } = await insertPurchase();
    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        transaction.insert(secondHandPurchaseItems).values({
          tenantId: tenant.id,
          secondHandPurchaseId: purchase.id,
          itemType: 'COIN',
          destinationInventoryType: 'COIN',
          grossWeightMg: 1_000n,
          itemSnapshot: { count: '1' },
        }),
      ),
    ).rejects.toThrow();
  });

  it('does not permit a completed purchase or its item snapshot to be rewritten', async () => {
    const { purchase, item } = await insertPurchase();

    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        transaction
          .update(secondHandPurchases)
          .set({ finalAmountRial: 1n })
          .where(eq(secondHandPurchases.id, purchase.id)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        transaction
          .update(secondHandPurchaseItems)
          .set({ pureWeightMg: 1n })
          .where(eq(secondHandPurchaseItems.id, item.id)),
      ),
    ).rejects.toThrow();
  });
});
