import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { InventoryMovementsService } from '../src/modules/inventory/inventory-movements.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import {
  SecondHandPurchasePaidRialExceedsAmountError,
  SecondHandPurchasePartyNotConsumerError,
} from '../src/modules/purchase/second-hand-gold-purchases.errors';
import { SecondHandGoldPurchasesService } from '../src/modules/purchase/second-hand-gold-purchases.service';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { VersionedSettingsService } from '../src/modules/pricing/versioned-settings.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
  assetDimensions,
  auditLogs,
  idempotencyRecords,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  secondHandPurchaseItems,
  secondHandPurchases,
  tenants,
} from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { IdempotencyService } from '../src/platform/idempotency/idempotency.service';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { UserService } from '../src/platform/users/user.service';
import type { Database } from '../src/platform/database/connect';
import type { INestApplicationContext } from '@nestjs/common';

describe('second-hand gold purchase (BE-050)', () => {
  const tenant = { id: '', slug: `second-hand-gold-${randomUUID().slice(0, 12)}` };
  let app: INestApplicationContext;
  let db: Database;
  let idempotency: IdempotencyService;
  let purchases: SecondHandGoldPurchasesService;
  let movements: InventoryMovementsService;
  let settings: VersionedSettingsService;
  let actorId = '';
  let consumerPartyId = '';
  let businessPartyId = '';
  let quoteId = '';
  let effectiveAt = new Date();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
    const tenantService = app.get(TenantService);
    const users = app.get(UserService);
    const parties = app.get(PartiesService);
    const quotes = app.get(PriceQuotesService);
    idempotency = app.get(IdempotencyService);
    purchases = app.get(SecondHandGoldPurchasesService);
    movements = app.get(InventoryMovementsService);
    settings = app.get(VersionedSettingsService);

    tenant.id = (
      await tenantService.create({ name: 'Second-hand gold tenant', slug: tenant.slug })
    ).id;
    effectiveAt = new Date();
    actorId = (
      await users.create({
        email: `${randomUUID().slice(0, 12)}@example.com`,
        displayName: 'Second-hand buyer',
      })
    ).id;
    consumerPartyId = (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        parties.createInTransaction(transaction, {
          tenantId: tenant.id,
          actorUserId: actorId,
          input: { type: 'CONSUMER', displayName: 'Gold seller' },
        }),
      )
    ).id;
    businessPartyId = (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        parties.createInTransaction(transaction, {
          tenantId: tenant.id,
          actorUserId: actorId,
          input: { type: 'BUSINESS', displayName: 'Business seller' },
        }),
      )
    ).id;
    quoteId = (
      await quotes.createManual({
        tenantId: tenant.id,
        quoteType: 'MAZNEH',
        amountRial: 100_000_000n,
        createdBy: actorId,
      })
    ).id;
  });

  afterAll(async () => {
    if (tenant.id !== '') await db.delete(tenants).where(eq(tenants.id, tenant.id));
    await app.close();
  });

  it('uses the versioned default karat, snapshots the purchase, records a partial payment, increases melted gold, and replays idempotently', async () => {
    const request = {
      partyId: consumerPartyId,
      grossWeightMg: '1000',
      stoneWeightMg: '100',
      otherDeductionWeightMg: '0',
      quoteId,
      feeRial: '25000',
      paidRial: '5000000',
      effectiveAt: effectiveAt.toISOString(),
    };
    const run = () =>
      idempotency.execute({
        tenantId: tenant.id,
        key: 'second-hand-gold-partial-1',
        request: { method: 'POST', path: '/purchase/second-hand/gold', body: request },
        execute: async (transaction) => {
          const created = await purchases.createInTransaction(transaction, {
            tenantId: tenant.id,
            partyId: consumerPartyId,
            grossWeightMg: 1_000n,
            stoneWeightMg: 100n,
            otherDeductionWeightMg: 0n,
            quoteId,
            feeRial: 25_000n,
            paidRial: 5_000_000n,
            effectiveAt,
            createdBy: actorId,
          });
          return {
            status: 201,
            body: {
              secondHandPurchaseId: created.secondHandPurchaseId,
              ledgerTransactionId: created.ledgerTransactionId,
              inventoryMovementId: created.inventoryMovementId,
              pureWeightMg: created.pureWeightMg.toString(),
              finalAmountRial: created.finalAmountRial.toString(),
              payableRial: created.payableRial.toString(),
            },
          };
        },
      });

    const inventoryBefore = await movements.balance(tenant.id, 'MELTED_GOLD', null);
    const first = await run();
    const replay = await run();

    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, response: first.response });
    expect(first.response.body).toMatchObject({
      pureWeightMg: '666',
      finalAmountRial: '20475000',
      payableRial: '15475000',
    });
    expect(await movements.balance(tenant.id, 'MELTED_GOLD', null)).toBe(inventoryBefore + 666n);

    const document = await withTenantTransaction(db, tenant.id, async (transaction) => {
      const [purchase] = await transaction
        .select()
        .from(secondHandPurchases)
        .where(eq(secondHandPurchases.id, first.response.body.secondHandPurchaseId));
      const [item] = await transaction
        .select()
        .from(secondHandPurchaseItems)
        .where(
          eq(
            secondHandPurchaseItems.secondHandPurchaseId,
            first.response.body.secondHandPurchaseId,
          ),
        );
      const [movement] = await transaction
        .select()
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.id, first.response.body.ledgerTransactionId));
      const entries = await transaction
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.transactionId, first.response.body.ledgerTransactionId));
      const [audit] = await transaction
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityId, first.response.body.secondHandPurchaseId),
            eq(auditLogs.action, 'SECOND_HAND_GOLD_PURCHASE_CREATED'),
          ),
        );
      const accounts = await transaction
        .select()
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.tenantId, tenant.id));
      const dimensions = await transaction
        .select()
        .from(assetDimensions)
        .where(eq(assetDimensions.tenantId, tenant.id));

      return {
        purchase: purchase!,
        item: item!,
        transaction: movement!,
        entries,
        audit: audit!,
        accounts,
        dimensions,
      };
    });

    expect(document.purchase).toMatchObject({
      partyId: consumerPartyId,
      sourceInvoiceId: null,
      lockedQuoteId: quoteId,
      lockedQuoteAmountRial: 100_000_000n,
      feeRial: 25_000n,
      finalAmountRial: 20_475_000n,
      settingsSnapshot: expect.objectContaining({
        defaultPurchaseKarat: '740',
        effectivePurchaseKarat: '740',
        roundingPolicy: 'HALF_UP',
      }),
      sellerIdentitySnapshot: {
        partyType: 'CONSUMER',
        displayName: 'Gold seller',
        mobile: null,
        nationalId: null,
      },
    });
    expect(document.item).toMatchObject({
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
    expect(document.transaction).toMatchObject({ sourceType: 'SECOND_HAND_PURCHASE' });
    expect(document.audit.afterData).toMatchObject({ payableRial: '15475000' });

    const bySystemKey = new Map(
      document.accounts.map((account) => [account.systemKey, account.id]),
    );
    const partyPayable = document.accounts.find(
      (account) => account.partyId === consumerPartyId && account.accountType === 'LIABILITY',
    )!;
    const rial = document.dimensions.find((dimension) => dimension.code === 'RIAL')!;
    const gold = document.dimensions.find((dimension) => dimension.code === 'GOLD')!;
    expect(document.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: bySystemKey.get('PURCHASE_FROM_CONSUMER'),
          dimensionId: rial.id,
          quantity: 20_475_000n,
        }),
        expect.objectContaining({
          accountId: bySystemKey.get('CASH'),
          dimensionId: rial.id,
          quantity: -5_000_000n,
        }),
        expect.objectContaining({
          accountId: partyPayable.id,
          dimensionId: rial.id,
          quantity: -15_475_000n,
        }),
        expect.objectContaining({
          accountId: bySystemKey.get('INVENTORY_MELTED_GOLD'),
          dimensionId: gold.id,
          quantity: 666n,
        }),
        expect.objectContaining({
          accountId: bySystemKey.get('PURCHASE_FROM_CONSUMER'),
          dimensionId: gold.id,
          quantity: -666n,
        }),
      ]),
    );
    const totals = new Map<string, bigint>();
    for (const entry of document.entries) {
      totals.set(entry.dimensionId, (totals.get(entry.dimensionId) ?? 0n) + entry.quantity);
    }
    for (const total of totals.values()) {
      expect(total).toBe(0n);
    }
  });

  it('uses the effective tenant setting rather than a fixed karat when the default changes', async () => {
    const changedEffectiveAt = new Date(effectiveAt.getTime() + 60_000);
    await settings.createVersion({
      tenantId: tenant.id,
      settingKey: 'purchase.second_hand_default_karat',
      valueJson: { value: '750' },
      validFrom: changedEffectiveAt,
      createdBy: actorId,
    });

    const created = await withTenantTransaction(db, tenant.id, (transaction) =>
      purchases.createInTransaction(transaction, {
        tenantId: tenant.id,
        partyId: consumerPartyId,
        grossWeightMg: 1_000n,
        stoneWeightMg: 0n,
        otherDeductionWeightMg: 0n,
        quoteId,
        feeRial: 0n,
        paidRial: 0n,
        effectiveAt: changedEffectiveAt,
        createdBy: actorId,
      }),
    );

    expect(created.pureWeightMg).toBe(750n);
    const [purchase] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select({ settingsSnapshot: secondHandPurchases.settingsSnapshot })
        .from(secondHandPurchases)
        .where(eq(secondHandPurchases.id, created.secondHandPurchaseId)),
    );
    expect(purchase!.settingsSnapshot).toMatchObject({
      defaultPurchaseKarat: '750',
      effectivePurchaseKarat: '750',
    });
  });

  it('rejects business sellers and rolls back every write plus the idempotency claim when payment exceeds today’s calculated amount', async () => {
    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        purchases.createInTransaction(transaction, {
          tenantId: tenant.id,
          partyId: businessPartyId,
          grossWeightMg: 1_000n,
          stoneWeightMg: 0n,
          otherDeductionWeightMg: 0n,
          quoteId,
          feeRial: 0n,
          paidRial: 0n,
          effectiveAt,
          createdBy: actorId,
        }),
      ),
    ).rejects.toBeInstanceOf(SecondHandPurchasePartyNotConsumerError);

    const inventoryBefore = await movements.balance(tenant.id, 'MELTED_GOLD', null);
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

    await expect(
      idempotency.execute({
        tenantId: tenant.id,
        key: 'second-hand-gold-failure',
        request: {
          method: 'POST',
          path: '/purchase/second-hand/gold',
          body: {
            partyId: consumerPartyId,
            grossWeightMg: '1000',
            quoteId,
            feeRial: '0',
            paidRial: '999999999999',
            effectiveAt: effectiveAt.toISOString(),
          },
        },
        execute: (transaction) =>
          purchases
            .createInTransaction(transaction, {
              tenantId: tenant.id,
              partyId: consumerPartyId,
              grossWeightMg: 1_000n,
              stoneWeightMg: 0n,
              otherDeductionWeightMg: 0n,
              quoteId,
              feeRial: 0n,
              paidRial: 999_999_999_999n,
              effectiveAt,
              createdBy: actorId,
            })
            .then((created) => ({
              status: 201,
              body: { secondHandPurchaseId: created.secondHandPurchaseId },
            })),
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
      keys: await transaction
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.tenantId, tenant.id),
            eq(idempotencyRecords.key, 'second-hand-gold-failure'),
          ),
        ),
    }));
    expect(after.purchases).toHaveLength(before.purchases.length);
    expect(after.ledger).toHaveLength(before.ledger.length);
    expect(after.keys).toHaveLength(0);
    expect(await movements.balance(tenant.id, 'MELTED_GOLD', null)).toBe(inventoryBefore);
  });
});
