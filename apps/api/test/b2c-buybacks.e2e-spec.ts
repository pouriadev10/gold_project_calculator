import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { OpeningBalancesService } from '../src/modules/inventory/opening-balances.service';
import { JewelryItemsService } from '../src/modules/inventory/jewelry-items.service';
import { InventoryMovementsService } from '../src/modules/inventory/inventory-movements.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import { B2cBuybackPartyNotConsumerError } from '../src/modules/purchase/b2c-buybacks.errors';
import { B2cBuybacksService } from '../src/modules/purchase/b2c-buybacks.service';
import { SecondHandPurchasePaidRialExceedsAmountError } from '../src/modules/purchase/second-hand-gold-purchases.errors';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { JewelryCashSalesService } from '../src/modules/sales/jewelry-cash-sales.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
  auditLogs,
  idempotencyRecords,
  ledgerEntries,
  ledgerTransactions,
  salesInvoices,
  salesInvoiceVersions,
  secondHandPurchases,
  tenants,
} from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { IdempotencyService } from '../src/platform/idempotency/idempotency.service';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { UserService } from '../src/platform/users/user.service';
import type { Database } from '../src/platform/database/connect';
import type { INestApplicationContext } from '@nestjs/common';

describe('B2C buyback (BE-052)', () => {
  const tenant = { id: '', slug: `b2c-buyback-${randomUUID().slice(0, 12)}` };
  let app: INestApplicationContext;
  let db: Database;
  let idempotency: IdempotencyService;
  let buybacks: B2cBuybacksService;
  let movements: InventoryMovementsService;
  let actorId = '';
  let consumerPartyId = '';
  let businessPartyId = '';
  let sourceInvoiceId = '';
  let originalQuoteId = '';
  let todayQuoteId = '';
  let originalEffectiveAt = new Date();
  let todayEffectiveAt = new Date();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
    const tenantService = app.get(TenantService);
    const users = app.get(UserService);
    const parties = app.get(PartiesService);
    const jewelryItems = app.get(JewelryItemsService);
    const openingBalances = app.get(OpeningBalancesService);
    const quotes = app.get(PriceQuotesService);
    const sales = app.get(JewelryCashSalesService);
    idempotency = app.get(IdempotencyService);
    buybacks = app.get(B2cBuybacksService);
    movements = app.get(InventoryMovementsService);

    tenant.id = (await tenantService.create({ name: 'B2C buyback tenant', slug: tenant.slug })).id;
    originalEffectiveAt = new Date();
    todayEffectiveAt = new Date(originalEffectiveAt.getTime() + 60_000);
    actorId = (
      await users.create({
        email: `${randomUUID().slice(0, 12)}@example.com`,
        displayName: 'Buyback cashier',
      })
    ).id;
    consumerPartyId = (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        parties.createInTransaction(transaction, {
          tenantId: tenant.id,
          actorUserId: actorId,
          input: { type: 'CONSUMER', displayName: 'Consumer buyer' },
        }),
      )
    ).id;
    businessPartyId = (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        parties.createInTransaction(transaction, {
          tenantId: tenant.id,
          actorUserId: actorId,
          input: { type: 'BUSINESS', displayName: 'Business buyer' },
        }),
      )
    ).id;

    const jewelry = await jewelryItems.createItem({
      tenantId: tenant.id,
      code: `BUYBACK-RING-${randomUUID().slice(0, 8)}`,
      title: 'Buyback ring',
      grossWeightMg: 1_000n,
      karat: 750,
      stoneWeightMg: 0n,
      otherDeductionWeightMg: 0n,
      wageType: 'FLAT',
      wageValue: 1_000_000n,
      validFrom: originalEffectiveAt,
      active: true,
    });
    originalQuoteId = (
      await quotes.createManual({
        tenantId: tenant.id,
        quoteType: 'MAZNEH',
        amountRial: 100_000_000n,
        createdBy: actorId,
      })
    ).id;
    todayQuoteId = (
      await quotes.createManual({
        tenantId: tenant.id,
        quoteType: 'MAZNEH',
        amountRial: 200_000_000n,
        createdBy: actorId,
      })
    ).id;
    await withTenantTransaction(db, tenant.id, (transaction) =>
      openingBalances.createInTransaction(transaction, {
        tenantId: tenant.id,
        effectiveAt: originalEffectiveAt,
        description: 'Opening source jewelry stock',
        createdBy: actorId,
        lines: [{ itemType: 'JEWELRY', itemId: jewelry.jewelryItemId, quantity: 1n }],
      }),
    );
    sourceInvoiceId = (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        sales.createInTransaction(transaction, {
          tenantId: tenant.id,
          partyId: consumerPartyId,
          jewelryItemId: jewelry.jewelryItemId,
          quoteId: originalQuoteId,
          effectiveAt: originalEffectiveAt,
          createdBy: actorId,
        }),
      )
    ).invoiceId;
  });

  afterAll(async () => {
    if (tenant.id !== '') await db.delete(tenants).where(eq(tenants.id, tenant.id));
    await app.close();
  });

  it('previews the server breakdown and both locked event snapshots without creating accounting side effects', async () => {
    const before = await withTenantTransaction(db, tenant.id, async (transaction) => {
      const [invoice] = await transaction
        .select()
        .from(salesInvoices)
        .where(eq(salesInvoices.id, sourceInvoiceId));
      const [version] = await transaction
        .select()
        .from(salesInvoiceVersions)
        .where(
          and(
            eq(salesInvoiceVersions.salesInvoiceId, sourceInvoiceId),
            eq(salesInvoiceVersions.version, 1),
          ),
        );
      return {
        invoice: invoice!,
        version: version!,
        purchases: await transaction
          .select()
          .from(secondHandPurchases)
          .where(eq(secondHandPurchases.tenantId, tenant.id)),
        ledger: await transaction
          .select()
          .from(ledgerTransactions)
          .where(eq(ledgerTransactions.tenantId, tenant.id)),
        audit: await transaction
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.tenantId, tenant.id)),
      };
    });
    const meltedBefore = await movements.balance(tenant.id, 'MELTED_GOLD', null);

    const preview = await buybacks.preview({
      tenantId: tenant.id,
      sourceInvoiceId,
      grossWeightMg: 1_000n,
      stoneWeightMg: 0n,
      otherDeductionWeightMg: 0n,
      quoteId: todayQuoteId,
      effectiveAt: todayEffectiveAt,
    });

    expect(preview.sourceInvoiceId).toBe(sourceInvoiceId);
    expect(preview.original).toMatchObject({
      effectiveAt: originalEffectiveAt,
      quoteAmountRial: 100_000_000n,
    });
    expect(preview.today).toMatchObject({
      effectiveAt: todayEffectiveAt,
      quoteAmountRial: 200_000_000n,
    });
    expect(preview.original.purchaseAmountRial).toBeGreaterThan(0n);
    expect(preview.today.purchaseAmountRial).toBeGreaterThan(0n);
    expect(preview.breakdown.differenceRial).toBe(
      preview.today.purchaseAmountRial - preview.original.purchaseAmountRial,
    );

    const after = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      invoice: (
        await transaction.select().from(salesInvoices).where(eq(salesInvoices.id, sourceInvoiceId))
      )[0]!,
      version: (
        await transaction
          .select()
          .from(salesInvoiceVersions)
          .where(
            and(
              eq(salesInvoiceVersions.salesInvoiceId, sourceInvoiceId),
              eq(salesInvoiceVersions.version, 1),
            ),
          )
      )[0]!,
      purchases: await transaction
        .select()
        .from(secondHandPurchases)
        .where(eq(secondHandPurchases.tenantId, tenant.id)),
      ledger: await transaction
        .select()
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.tenantId, tenant.id)),
      audit: await transaction.select().from(auditLogs).where(eq(auditLogs.tenantId, tenant.id)),
    }));

    expect(after).toEqual(before);
    expect(await movements.balance(tenant.id, 'MELTED_GOLD', null)).toBe(meltedBefore);
  });

  it('creates a linked second-hand purchase with today’s price, preserves the original invoice, posts melted gold, and returns a balanced difference breakdown', async () => {
    const paidRial = 20_000_000n;
    const request = {
      grossWeightMg: '1000',
      quoteId: todayQuoteId,
      paidRial: paidRial.toString(),
      effectiveAt: todayEffectiveAt.toISOString(),
    };
    const sourceBefore = await withTenantTransaction(db, tenant.id, async (transaction) => {
      const [invoice] = await transaction
        .select()
        .from(salesInvoices)
        .where(eq(salesInvoices.id, sourceInvoiceId));
      const [version] = await transaction
        .select()
        .from(salesInvoiceVersions)
        .where(
          and(
            eq(salesInvoiceVersions.salesInvoiceId, sourceInvoiceId),
            eq(salesInvoiceVersions.version, 1),
          ),
        );
      return { invoice: invoice!, version: version! };
    });
    const run = () =>
      idempotency.execute({
        tenantId: tenant.id,
        key: 'b2c-buyback-1',
        request: {
          method: 'POST',
          path: `/sales/invoices/${sourceInvoiceId}/b2c-buyback`,
          body: request,
        },
        execute: async (transaction) => {
          const created = await buybacks.createInTransaction(transaction, {
            tenantId: tenant.id,
            sourceInvoiceId,
            grossWeightMg: 1_000n,
            stoneWeightMg: 0n,
            otherDeductionWeightMg: 0n,
            quoteId: todayQuoteId,
            paidRial,
            effectiveAt: todayEffectiveAt,
            createdBy: actorId,
          });
          return {
            status: 201,
            body: {
              secondHandPurchaseId: created.secondHandPurchaseId,
              ledgerTransactionId: created.ledgerTransactionId,
              inventoryMovementId: created.inventoryMovementId,
              pureWeightMg: created.pureWeightMg.toString(),
              todayPurchaseAmountRial: created.todayPurchaseAmountRial.toString(),
              breakdown: Object.fromEntries(
                Object.entries(created.breakdown).map(([key, value]) => [key, value.toString()]),
              ),
            },
          };
        },
      });

    const meltedBefore = await movements.balance(tenant.id, 'MELTED_GOLD', null);
    const first = await run();
    const replay = await run();

    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, response: first.response });
    expect(BigInt(first.response.body.breakdown.differenceRial as string)).toBeGreaterThan(0n);
    expect(await movements.balance(tenant.id, 'MELTED_GOLD', null)).toBe(
      meltedBefore + BigInt(first.response.body.pureWeightMg),
    );

    const after = await withTenantTransaction(db, tenant.id, async (transaction) => {
      const [invoice] = await transaction
        .select()
        .from(salesInvoices)
        .where(eq(salesInvoices.id, sourceInvoiceId));
      const [version] = await transaction
        .select()
        .from(salesInvoiceVersions)
        .where(
          and(
            eq(salesInvoiceVersions.salesInvoiceId, sourceInvoiceId),
            eq(salesInvoiceVersions.version, 1),
          ),
        );
      const [purchase] = await transaction
        .select()
        .from(secondHandPurchases)
        .where(eq(secondHandPurchases.id, first.response.body.secondHandPurchaseId));
      const entries = await transaction
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.transactionId, first.response.body.ledgerTransactionId));
      const [ledger] = await transaction
        .select()
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.id, first.response.body.ledgerTransactionId));
      const [audit] = await transaction
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityId, first.response.body.secondHandPurchaseId),
            eq(auditLogs.action, 'B2C_BUYBACK_CREATED'),
          ),
        );
      return {
        invoice: invoice!,
        version: version!,
        purchase: purchase!,
        entries,
        ledger: ledger!,
        audit: audit!,
      };
    });

    expect(after.invoice).toEqual(sourceBefore.invoice);
    expect(after.version).toEqual(sourceBefore.version);
    expect(after.purchase).toMatchObject({
      sourceInvoiceId,
      partyId: consumerPartyId,
      feeRial: 0n,
      finalAmountRial: BigInt(first.response.body.todayPurchaseAmountRial),
    });
    expect(after.ledger).toMatchObject({ sourceType: 'SECOND_HAND_PURCHASE' });
    expect(after.audit.afterData).toMatchObject({ sourceInvoiceId });

    const breakdown = first.response.body.breakdown as Record<string, string>;
    const difference = BigInt(breakdown.differenceRial!);
    const market = BigInt(breakdown.marketPriceDifferenceRial!);
    const karatDifference = BigInt(breakdown.karatDifferenceRial!);
    const wageBurned = BigInt(breakdown.wageBurnedRial!);
    const other = BigInt(breakdown.otherCalculationDifferenceRial!);
    const sourceTotals = sourceBefore.version.totalsSnapshot as Record<string, string>;
    expect(wageBurned).toBe(BigInt(sourceTotals.wageRial!));
    expect(difference).toBe(
      BigInt(first.response.body.todayPurchaseAmountRial) - BigInt(sourceTotals.payableRial!),
    );
    expect(difference).toBe(market + karatDifference - wageBurned + other);

    const totals = new Map<string, bigint>();
    for (const entry of after.entries) {
      totals.set(entry.dimensionId, (totals.get(entry.dimensionId) ?? 0n) + entry.quantity);
    }
    for (const total of totals.values()) {
      expect(total).toBe(0n);
    }
  });

  it('does not implement B2B return behavior', async () => {
    const [businessInvoice] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .insert(salesInvoices)
        .values({
          tenantId: tenant.id,
          invoiceNumber: 9_999,
          currentVersion: 1,
          status: 'FINALIZED',
          partyId: businessPartyId,
          quoteId: originalQuoteId,
          quoteAmountRial: 100_000_000n,
          quoteObservedAt: originalEffectiveAt,
          finalizedAt: originalEffectiveAt,
          createdBy: actorId,
        })
        .returning(),
    );

    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        buybacks.createInTransaction(transaction, {
          tenantId: tenant.id,
          sourceInvoiceId: businessInvoice!.id,
          grossWeightMg: 1_000n,
          stoneWeightMg: 0n,
          otherDeductionWeightMg: 0n,
          quoteId: todayQuoteId,
          paidRial: 0n,
          effectiveAt: todayEffectiveAt,
          createdBy: actorId,
        }),
      ),
    ).rejects.toBeInstanceOf(B2cBuybackPartyNotConsumerError);
  });

  it('rolls back the new purchase and idempotency claim when today’s payment exceeds today’s computed amount', async () => {
    const before = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      purchases: await transaction
        .select()
        .from(secondHandPurchases)
        .where(eq(secondHandPurchases.tenantId, tenant.id)),
      ledger: await transaction
        .select()
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.tenantId, tenant.id)),
    }));
    const meltedBefore = await movements.balance(tenant.id, 'MELTED_GOLD', null);

    await expect(
      idempotency.execute({
        tenantId: tenant.id,
        key: 'b2c-buyback-overpayment',
        request: {
          method: 'POST',
          path: `/sales/invoices/${sourceInvoiceId}/b2c-buyback`,
          body: {
            grossWeightMg: '1000',
            quoteId: todayQuoteId,
            paidRial: '999999999999',
            effectiveAt: todayEffectiveAt.toISOString(),
          },
        },
        execute: (transaction) =>
          buybacks
            .createInTransaction(transaction, {
              tenantId: tenant.id,
              sourceInvoiceId,
              grossWeightMg: 1_000n,
              stoneWeightMg: 0n,
              otherDeductionWeightMg: 0n,
              quoteId: todayQuoteId,
              paidRial: 999_999_999_999n,
              effectiveAt: todayEffectiveAt,
              createdBy: actorId,
            })
            .then((created) => ({ status: 201, body: { id: created.secondHandPurchaseId } })),
      }),
    ).rejects.toBeInstanceOf(SecondHandPurchasePaidRialExceedsAmountError);

    const after = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      purchases: await transaction
        .select()
        .from(secondHandPurchases)
        .where(eq(secondHandPurchases.tenantId, tenant.id)),
      ledger: await transaction
        .select()
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.tenantId, tenant.id)),
      key: await transaction
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.tenantId, tenant.id),
            eq(idempotencyRecords.key, 'b2c-buyback-overpayment'),
          ),
        ),
    }));
    expect(after.purchases).toHaveLength(before.purchases.length);
    expect(after.ledger).toHaveLength(before.ledger.length);
    expect(after.key).toHaveLength(0);
    expect(await movements.balance(tenant.id, 'MELTED_GOLD', null)).toBe(meltedBefore);
  });
});
