import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { bubble, gramRate1000, grossUg, karat, rial } from '@gold/core-calc';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { CoinTypesService } from '../src/modules/inventory/coin-types.service';
import { InventoryMovementsService } from '../src/modules/inventory/inventory-movements.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import {
  SecondHandPurchasePaidRialExceedsAmountError,
  SecondHandPurchasePartyNotConsumerError,
} from '../src/modules/purchase/second-hand-gold-purchases.errors';
import { SecondHandCoinPurchasesService } from '../src/modules/purchase/second-hand-coin-purchases.service';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
  assetDimensions,
  auditLogs,
  coinTypes,
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

describe('second-hand coin purchase (BE-051)', () => {
  const tenant = { id: '', slug: `second-hand-coin-${randomUUID().slice(0, 12)}` };
  const maznehRial = 100_000_000n;
  let app: INestApplicationContext;
  let db: Database;
  let idempotency: IdempotencyService;
  let purchases: SecondHandCoinPurchasesService;
  let movements: InventoryMovementsService;
  let actorId = '';
  let consumerPartyId = '';
  let businessPartyId = '';
  let centralBankCoinTypeId = '';
  let privateCoinTypeId = '';
  let quoteId = '';
  let effectiveAt = new Date();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
    const tenantService = app.get(TenantService);
    const users = app.get(UserService);
    const parties = app.get(PartiesService);
    const coinTypesService = app.get(CoinTypesService);
    const quotes = app.get(PriceQuotesService);
    idempotency = app.get(IdempotencyService);
    purchases = app.get(SecondHandCoinPurchasesService);
    movements = app.get(InventoryMovementsService);

    tenant.id = (
      await tenantService.create({ name: 'Second-hand coin tenant', slug: tenant.slug })
    ).id;
    effectiveAt = new Date();
    actorId = (
      await users.create({
        email: `${randomUUID().slice(0, 12)}@example.com`,
        displayName: 'Coin buyer',
      })
    ).id;
    consumerPartyId = (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        parties.createInTransaction(transaction, {
          tenantId: tenant.id,
          actorUserId: actorId,
          input: { type: 'CONSUMER', displayName: 'Coin seller' },
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

    const [seededCentralBank] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select({ id: coinTypes.id })
        .from(coinTypes)
        .where(and(eq(coinTypes.tenantId, tenant.id), eq(coinTypes.code, 'BAHAR_AZADI_NEW'))),
    );
    centralBankCoinTypeId = seededCentralBank!.id;
    privateCoinTypeId = (
      await coinTypesService.createType({
        tenantId: tenant.id,
        code: `PRIVATE-${randomUUID().slice(0, 8)}`,
        title: 'Private mint coin',
        mintType: 'PRIVATE_MINT',
        grossWeightUg: 8_133_000n,
        karat: 900,
        isCentralBankMinted: false,
        validFrom: effectiveAt,
        active: true,
      })
    ).coinTypeId;
    quoteId = (
      await quotes.createManual({
        tenantId: tenant.id,
        quoteType: 'MAZNEH',
        amountRial: maznehRial,
        createdBy: actorId,
      })
    ).id;
  });

  afterAll(async () => {
    if (tenant.id !== '') await db.delete(tenants).where(eq(tenants.id, tenant.id));
    await app.close();
  });

  it('increases only the selected coin count, records the unpaid amount, snapshots the purchase rate and central-bank bubble, and replays idempotently', async () => {
    const count = 2;
    const purchaseUnitPriceRial = 220_000_000n;
    const purchaseAmountRial = BigInt(count) * purchaseUnitPriceRial;
    const paidRial = 100_000_000n;
    const request = {
      partyId: consumerPartyId,
      coinTypeId: centralBankCoinTypeId,
      count,
      purchaseUnitPriceRial: purchaseUnitPriceRial.toString(),
      quoteId,
      paidRial: paidRial.toString(),
      effectiveAt: effectiveAt.toISOString(),
    };
    const run = () =>
      idempotency.execute({
        tenantId: tenant.id,
        key: 'second-hand-coin-partial-1',
        request: { method: 'POST', path: '/purchase/second-hand/coins', body: request },
        execute: async (transaction) => {
          const created = await purchases.createInTransaction(transaction, {
            tenantId: tenant.id,
            partyId: consumerPartyId,
            coinTypeId: centralBankCoinTypeId,
            count,
            purchaseUnitPriceRial,
            quoteId,
            paidRial,
            effectiveAt,
            createdBy: actorId,
          });
          return {
            status: 201,
            body: {
              secondHandPurchaseId: created.secondHandPurchaseId,
              ledgerTransactionId: created.ledgerTransactionId,
              inventoryMovementId: created.inventoryMovementId,
              purchaseAmountRial: created.purchaseAmountRial.toString(),
              payableRial: created.payableRial.toString(),
              bubbleRial: created.bubbleRial === null ? null : created.bubbleRial.toString(),
            },
          };
        },
      });

    const centralBefore = await movements.balance(tenant.id, 'COIN', centralBankCoinTypeId);
    const privateBefore = await movements.balance(tenant.id, 'COIN', privateCoinTypeId);
    const first = await run();
    const replay = await run();

    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, response: first.response });
    expect(first.response.body).toMatchObject({
      purchaseAmountRial: purchaseAmountRial.toString(),
      payableRial: (purchaseAmountRial - paidRial).toString(),
    });
    expect(await movements.balance(tenant.id, 'COIN', centralBankCoinTypeId)).toBe(
      centralBefore + BigInt(count),
    );
    expect(await movements.balance(tenant.id, 'COIN', privateCoinTypeId)).toBe(privateBefore);

    const centralBankCoin = {
      kind: 'coin' as const,
      id: centralBankCoinTypeId,
      label: 'Central-bank coin',
      grossWeightUg: grossUg(8_133_000n),
      karat: karat(900),
      isCentralBankMinted: true as const,
    };
    expect(first.response.body.bubbleRial).toBe(
      bubble(centralBankCoin, rial(purchaseUnitPriceRial), gramRate1000(maznehRial)).toString(),
    );

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
      const entries = await transaction
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.transactionId, first.response.body.ledgerTransactionId));
      const accounts = await transaction
        .select()
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.tenantId, tenant.id));
      const dimensions = await transaction
        .select()
        .from(assetDimensions)
        .where(eq(assetDimensions.tenantId, tenant.id));
      const [audit] = await transaction
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityId, first.response.body.secondHandPurchaseId),
            eq(auditLogs.action, 'SECOND_HAND_COIN_PURCHASE_CREATED'),
          ),
        );

      return { purchase: purchase!, item: item!, entries, accounts, dimensions, audit: audit! };
    });

    expect(document.purchase).toMatchObject({
      partyId: consumerPartyId,
      sourceInvoiceId: null,
      lockedQuoteId: quoteId,
      feeRial: 0n,
      finalAmountRial: purchaseAmountRial,
      settingsSnapshot: expect.objectContaining({
        purchaseUnitPriceRial: purchaseUnitPriceRial.toString(),
        goldRate1000Rial: gramRate1000(maznehRial).toString(),
      }),
    });
    expect(document.item).toMatchObject({
      itemType: 'COIN',
      destinationInventoryType: 'COIN',
      coinTypeId: centralBankCoinTypeId,
      coinCount: count,
      grossWeightMg: null,
      stoneWeightMg: null,
      otherDeductionWeightMg: null,
      purchaseKarat: null,
      pureWeightMg: null,
    });
    expect(document.audit.afterData).toMatchObject({
      count: count.toString(),
      purchaseAmountRial: purchaseAmountRial.toString(),
    });

    const bySystemKey = new Map(
      document.accounts.map((account) => [account.systemKey, account.id]),
    );
    const partyPayable = document.accounts.find(
      (account) => account.partyId === consumerPartyId && account.accountType === 'LIABILITY',
    )!;
    const rialDimension = document.dimensions.find((dimension) => dimension.code === 'RIAL')!;
    const coinDimension = document.dimensions.find(
      (dimension) => dimension.coinTypeId === centralBankCoinTypeId,
    )!;
    expect(document.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: bySystemKey.get('PURCHASE_FROM_CONSUMER'),
          dimensionId: rialDimension.id,
          quantity: purchaseAmountRial,
        }),
        expect.objectContaining({
          accountId: bySystemKey.get('CASH'),
          dimensionId: rialDimension.id,
          quantity: -paidRial,
        }),
        expect.objectContaining({
          accountId: partyPayable.id,
          dimensionId: rialDimension.id,
          quantity: -(purchaseAmountRial - paidRial),
        }),
        expect.objectContaining({
          accountId: bySystemKey.get(`INVENTORY_COIN:${centralBankCoinTypeId}`),
          dimensionId: coinDimension.id,
          quantity: BigInt(count),
        }),
        expect.objectContaining({
          accountId: bySystemKey.get('PURCHASE_FROM_CONSUMER'),
          dimensionId: coinDimension.id,
          quantity: -BigInt(count),
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

  it('does not calculate a bubble for a non-central-bank coin', async () => {
    const created = await withTenantTransaction(db, tenant.id, (transaction) =>
      purchases.createInTransaction(transaction, {
        tenantId: tenant.id,
        partyId: consumerPartyId,
        coinTypeId: privateCoinTypeId,
        count: 1,
        purchaseUnitPriceRial: 210_000_000n,
        quoteId,
        paidRial: 210_000_000n,
        effectiveAt,
        createdBy: actorId,
      }),
    );

    expect(created.bubbleRial).toBeNull();
    expect(created.intrinsicValueRial).toBeGreaterThan(0n);
    expect(await movements.balance(tenant.id, 'COIN', privateCoinTypeId)).toBe(1n);
  });

  it('rejects a business seller and rolls back the purchase, posting, movement, and idempotency claim on overpayment', async () => {
    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        purchases.createInTransaction(transaction, {
          tenantId: tenant.id,
          partyId: businessPartyId,
          coinTypeId: centralBankCoinTypeId,
          count: 1,
          purchaseUnitPriceRial: 220_000_000n,
          quoteId,
          paidRial: 0n,
          effectiveAt,
          createdBy: actorId,
        }),
      ),
    ).rejects.toBeInstanceOf(SecondHandPurchasePartyNotConsumerError);

    const inventoryBefore = await movements.balance(tenant.id, 'COIN', centralBankCoinTypeId);
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
        key: 'second-hand-coin-failure',
        request: {
          method: 'POST',
          path: '/purchase/second-hand/coins',
          body: {
            partyId: consumerPartyId,
            coinTypeId: centralBankCoinTypeId,
            count: 1,
            purchaseUnitPriceRial: '220000000',
            quoteId,
            paidRial: '999999999999',
            effectiveAt: effectiveAt.toISOString(),
          },
        },
        execute: (transaction) =>
          purchases
            .createInTransaction(transaction, {
              tenantId: tenant.id,
              partyId: consumerPartyId,
              coinTypeId: centralBankCoinTypeId,
              count: 1,
              purchaseUnitPriceRial: 220_000_000n,
              quoteId,
              paidRial: 999_999_999_999n,
              effectiveAt,
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
            eq(idempotencyRecords.key, 'second-hand-coin-failure'),
          ),
        ),
    }));
    expect(after.purchases).toHaveLength(before.purchases.length);
    expect(after.ledger).toHaveLength(before.ledger.length);
    expect(after.key).toHaveLength(0);
    expect(await movements.balance(tenant.id, 'COIN', centralBankCoinTypeId)).toBe(inventoryBefore);
  });
});
