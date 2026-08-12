import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { bubble, gramRate1000, grossUg, karat, rial } from '@gold/core-calc';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { CoinTypesService } from '../src/modules/inventory/coin-types.service';
import { InventoryMovementsService } from '../src/modules/inventory/inventory-movements.service';
import { OpeningBalancesService } from '../src/modules/inventory/opening-balances.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { CoinSalePaidRialExceedsPayableError } from '../src/modules/sales/coin-sales.errors';
import { CoinSalesService } from '../src/modules/sales/coin-sales.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import { IdempotencyService } from '../src/platform/idempotency/idempotency.service';
import {
  assetDimensions,
  coinTypes,
  idempotencyRecords,
  ledgerAccounts,
  ledgerEntries,
  salesInvoices,
  tenants,
} from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { UserService } from '../src/platform/users/user.service';
import type { Database } from '../src/platform/database/connect';
import type { INestApplicationContext } from '@nestjs/common';

describe('coin sale (BE-043)', () => {
  const tenant = { id: '', slug: `coin-sale-${randomUUID().slice(0, 12)}` };
  const maznehRial = 100_000_000n;
  let app: INestApplicationContext;
  let db: Database;
  let idempotency: IdempotencyService;
  let sales: CoinSalesService;
  let movements: InventoryMovementsService;
  let actorId = '';
  let partyId = '';
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
    const opening = app.get(OpeningBalancesService);
    idempotency = app.get(IdempotencyService);
    sales = app.get(CoinSalesService);
    movements = app.get(InventoryMovementsService);

    tenant.id = (await tenantService.create({ name: 'Coin sale tenant', slug: tenant.slug })).id;
    effectiveAt = new Date();
    actorId = (
      await users.create({ email: `${randomUUID().slice(0, 12)}@example.com`, displayName: 'Cashier' })
    ).id;
    partyId = (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        parties.createInTransaction(transaction, {
          tenantId: tenant.id,
          actorUserId: actorId,
          input: { type: 'CONSUMER', displayName: 'Buyer' },
        }),
      )
    ).id;

    // BE-020's INITIAL_COIN_TYPES seeds automatically on tenant creation (TenantInitializationModule).
    const [seededCentralBank] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select({ id: coinTypes.id })
        .from(coinTypes)
        .where(and(eq(coinTypes.tenantId, tenant.id), eq(coinTypes.code, 'BAHAR_AZADI_NEW'))),
    );
    centralBankCoinTypeId = seededCentralBank!.id;

    const privateVersion = await coinTypesService.createType({
      tenantId: tenant.id,
      code: `PRIVATE-${randomUUID().slice(0, 8)}`,
      title: 'Private mint coin',
      mintType: 'PRIVATE_MINT',
      grossWeightUg: 8_133_000n,
      karat: 900,
      isCentralBankMinted: false,
      validFrom: effectiveAt,
      active: true,
    });
    privateCoinTypeId = privateVersion.coinTypeId;

    quoteId = (
      await quotes.createManual({
        tenantId: tenant.id,
        quoteType: 'MAZNEH',
        amountRial: maznehRial,
        createdBy: actorId,
      })
    ).id;

    await withTenantTransaction(db, tenant.id, (transaction) =>
      opening.createInTransaction(transaction, {
        tenantId: tenant.id,
        effectiveAt,
        description: 'Opening coin stock',
        createdBy: actorId,
        lines: [
          { itemType: 'COIN', itemId: centralBankCoinTypeId, quantity: 5n },
          { itemType: 'COIN', itemId: privateCoinTypeId, quantity: 5n },
        ],
      }),
    );
  });

  afterAll(async () => {
    if (tenant.id !== '') await db.delete(tenants).where(eq(tenants.id, tenant.id));
    await app.close();
  });

  it('finalizes one invoice, deducts only the sold coin type, posts a balanced ledger keyed to its own dimension, records the market bubble, and replays idempotently', async () => {
    const marketUnitPriceRial = 250_000_000n;
    const count = 2;
    const payableRial = BigInt(count) * marketUnitPriceRial;
    const request = {
      partyId,
      coinTypeId: centralBankCoinTypeId,
      count,
      marketUnitPriceRial: marketUnitPriceRial.toString(),
      quoteId,
      effectiveAt: effectiveAt.toISOString(),
      paidRial: payableRial.toString(),
    };
    const run = () =>
      idempotency.execute({
        tenantId: tenant.id,
        key: 'coin-sale-cash-1',
        request: { method: 'POST', path: '/sales/invoices/coins', body: request },
        execute: async (transaction) => {
          const result = await sales.createInTransaction(transaction, {
            tenantId: tenant.id,
            partyId,
            coinTypeId: centralBankCoinTypeId,
            count,
            marketUnitPriceRial,
            quoteId,
            effectiveAt,
            paidRial: payableRial,
            createdBy: actorId,
          });
          return {
            status: 201,
            body: {
              invoiceId: result.invoiceId,
              payableRial: result.payableRial.toString(),
              bubbleRial: result.bubbleRial === null ? null : result.bubbleRial.toString(),
              ledgerTransactionId: result.ledgerTransactionId,
            },
          };
        },
      });

    const first = await run();
    const replay = await run();
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, response: first.response });
    expect(first.response.body.payableRial).toBe(payableRial.toString());

    expect(await movements.balance(tenant.id, 'COIN', centralBankCoinTypeId)).toBe(3n);
    expect(await movements.balance(tenant.id, 'COIN', privateCoinTypeId)).toBe(5n);

    const rate1000 = gramRate1000(maznehRial);
    const centralBankCoin = {
      kind: 'coin' as const,
      id: centralBankCoinTypeId,
      label: 'بهار آزادی',
      grossWeightUg: grossUg(8_133_000n),
      karat: karat(900),
      isCentralBankMinted: true as const,
    };
    const expectedBubble = bubble(centralBankCoin, rial(marketUnitPriceRial), rate1000);
    expect(first.response.body.bubbleRial).toBe(expectedBubble.toString());

    const entries = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.tenantId, tenant.id),
            eq(ledgerEntries.transactionId, first.response.body.ledgerTransactionId),
          ),
        ),
    );
    const totalsByDimension = new Map<string, bigint>();
    for (const entry of entries) {
      totalsByDimension.set(entry.dimensionId, (totalsByDimension.get(entry.dimensionId) ?? 0n) + entry.quantity);
    }
    for (const total of totalsByDimension.values()) {
      expect(total).toBe(0n);
    }

    const [coinDimension, otherCoinDimension] = await withTenantTransaction(db, tenant.id, (transaction) =>
      Promise.all([
        transaction
          .select()
          .from(assetDimensions)
          .where(and(eq(assetDimensions.tenantId, tenant.id), eq(assetDimensions.coinTypeId, centralBankCoinTypeId)))
          .then(([found]) => found!),
        transaction
          .select()
          .from(assetDimensions)
          .where(and(eq(assetDimensions.tenantId, tenant.id), eq(assetDimensions.coinTypeId, privateCoinTypeId)))
          .then(([found]) => found!),
      ]),
    );
    const coinEntries = entries.filter((entry) => entry.dimensionId === coinDimension.id);
    expect(coinEntries.map((entry) => entry.quantity).sort()).toEqual([-BigInt(count), BigInt(count)]);
    expect(entries.some((entry) => entry.dimensionId === otherCoinDimension.id)).toBe(false);
  });

  it('leaves the bubble null for a non-central-bank coin while still recording its intrinsic value', async () => {
    const marketUnitPriceRial = 240_000_000n;
    const result = await withTenantTransaction(db, tenant.id, (transaction) =>
      sales.createInTransaction(transaction, {
        tenantId: tenant.id,
        partyId,
        coinTypeId: privateCoinTypeId,
        count: 1,
        marketUnitPriceRial,
        quoteId,
        effectiveAt,
        paidRial: marketUnitPriceRial,
        createdBy: actorId,
      }),
    );

    expect(result.bubbleRial).toBeNull();
    expect(result.intrinsicValueRial).toBeGreaterThan(0n);
    expect(await movements.balance(tenant.id, 'COIN', privateCoinTypeId)).toBe(4n);
  });

  it('records the unpaid portion in the customer receivable subledger', async () => {
    const marketUnitPriceRial = 250_000_000n;
    const created = await withTenantTransaction(db, tenant.id, (transaction) =>
      sales.createInTransaction(transaction, {
        tenantId: tenant.id,
        partyId,
        coinTypeId: centralBankCoinTypeId,
        count: 1,
        marketUnitPriceRial,
        quoteId,
        effectiveAt,
        paidRial: 0n,
        createdBy: actorId,
      }),
    );

    const [receivable] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.tenantId, tenant.id),
            eq(ledgerAccounts.partyId, partyId),
            eq(ledgerAccounts.accountType, 'ASSET'),
          ),
        ),
    );
    const receivableEntries = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.tenantId, tenant.id), eq(ledgerEntries.accountId, receivable!.id))),
    );

    expect(created.receivableRial).toBe(created.payableRial);
    expect(receivableEntries.reduce((total, entry) => total + entry.quantity, 0n)).toBe(created.receivableRial);
  });

  it('rejects a paid amount above the calculated total without touching inventory', async () => {
    const marketUnitPriceRial = 250_000_000n;
    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        sales.createInTransaction(transaction, {
          tenantId: tenant.id,
          partyId,
          coinTypeId: centralBankCoinTypeId,
          count: 1,
          marketUnitPriceRial,
          quoteId,
          effectiveAt,
          paidRial: marketUnitPriceRial + 1n,
          createdBy: actorId,
        }),
      ),
    ).rejects.toThrow(CoinSalePaidRialExceedsPayableError);
  });

  it('rolls back the draft and idempotency claim when the coin type does not exist', async () => {
    const before = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction.select().from(salesInvoices).where(eq(salesInvoices.tenantId, tenant.id)),
    );

    await expect(
      idempotency.execute({
        tenantId: tenant.id,
        key: 'coin-sale-failure',
        request: {
          method: 'POST',
          path: '/sales/invoices/coins',
          body: {
            partyId,
            coinTypeId: randomUUID(),
            count: 1,
            marketUnitPriceRial: '250000000',
            quoteId,
            effectiveAt: effectiveAt.toISOString(),
            paidRial: '250000000',
          },
        },
        execute: async (transaction) => {
          const result = await sales.createInTransaction(transaction, {
            tenantId: tenant.id,
            partyId,
            coinTypeId: randomUUID(),
            count: 1,
            marketUnitPriceRial: 250_000_000n,
            quoteId,
            effectiveAt,
            paidRial: 250_000_000n,
            createdBy: actorId,
          });
          return { status: 201, body: { invoiceId: result.invoiceId } };
        },
      }),
    ).rejects.toThrow();

    const after = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      invoices: await transaction.select().from(salesInvoices).where(eq(salesInvoices.tenantId, tenant.id)),
      keys: await transaction
        .select()
        .from(idempotencyRecords)
        .where(and(eq(idempotencyRecords.tenantId, tenant.id), eq(idempotencyRecords.key, 'coin-sale-failure'))),
    }));
    expect(after.invoices).toHaveLength(before.length);
    expect(after.keys).toHaveLength(0);
    expect(await movements.balance(tenant.id, 'COIN', centralBankCoinTypeId)).toBe(2n);
  });
});
