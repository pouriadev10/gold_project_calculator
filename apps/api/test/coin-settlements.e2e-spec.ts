import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { InventoryMovementsService } from '../src/modules/inventory/inventory-movements.service';
import { AccountBalanceService } from '../src/modules/ledger/account-balance.service';
import { LedgerAccountsService } from '../src/modules/ledger/ledger-accounts.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { CoinSettlementsService } from '../src/modules/settlement/coin-settlements.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
  assetDimensions,
  coinTypes,
  idempotencyRecords,
  inventoryMovements,
  ledgerEntries,
  ledgerTransactions,
  settlementLines,
  settlements,
  tenants,
} from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { IdempotencyService } from '../src/platform/idempotency/idempotency.service';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { UserService } from '../src/platform/users/user.service';
import type { Database } from '../src/platform/database/connect';
import type { INestApplicationContext } from '@nestjs/common';

describe('coin settlement on a party rial balance (BE-047)', () => {
  const tenant = { id: '', slug: `coin-settlement-${randomUUID().slice(0, 12)}` };
  const effectiveAt = new Date();
  const maznehRial = 100_000_000n;
  let app: INestApplicationContext;
  let db: Database;
  let idempotency: IdempotencyService;
  let settlementService: CoinSettlementsService;
  let balances: AccountBalanceService;
  let movements: InventoryMovementsService;
  let actorId = '';
  let partyId = '';
  let quoteId = '';
  let centralBankCoinTypeId = '';
  let otherCoinTypeId = '';
  let receivableAccountId = '';
  let coinInventoryAccountId = '';
  let clearingAccountId = '';
  let coinDimensionId = '';
  let otherCoinDimensionId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
    const tenantService = app.get(TenantService);
    const users = app.get(UserService);
    const parties = app.get(PartiesService);
    const accounts = app.get(LedgerAccountsService);
    const quotes = app.get(PriceQuotesService);
    idempotency = app.get(IdempotencyService);
    settlementService = app.get(CoinSettlementsService);
    balances = app.get(AccountBalanceService);
    movements = app.get(InventoryMovementsService);

    tenant.id = (
      await tenantService.create({ name: 'Coin settlement tenant', slug: tenant.slug })
    ).id;
    actorId = (
      await users.create({
        email: `${randomUUID().slice(0, 12)}@example.com`,
        displayName: 'Cashier',
      })
    ).id;
    partyId = (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        parties.createInTransaction(transaction, {
          tenantId: tenant.id,
          actorUserId: actorId,
          input: { type: 'CONSUMER', displayName: 'Coin-paying debtor' },
        }),
      )
    ).id;

    const coinTypeRows = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select({ id: coinTypes.id, code: coinTypes.code })
        .from(coinTypes)
        .where(and(eq(coinTypes.tenantId, tenant.id), eq(coinTypes.code, 'BAHAR_AZADI_NEW'))),
    );
    centralBankCoinTypeId = coinTypeRows[0]!.id;
    const otherCoinTypeRows = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select({ id: coinTypes.id })
        .from(coinTypes)
        .where(and(eq(coinTypes.tenantId, tenant.id), eq(coinTypes.code, 'GERAMI'))),
    );
    otherCoinTypeId = otherCoinTypeRows[0]!.id;

    const partyAccounts = await accounts.ensurePartyAccounts({ tenantId: tenant.id, partyId });
    receivableAccountId = partyAccounts.receivable.id;
    [coinInventoryAccountId, clearingAccountId, coinDimensionId, otherCoinDimensionId] =
      await withTenantTransaction(db, tenant.id, async (transaction) => {
        const [coinInventory, clearing, coinDimension, otherCoinDimension] = await Promise.all([
          accounts.getRequiredSystemAccountInTransaction(
            transaction,
            tenant.id,
            `INVENTORY_COIN:${centralBankCoinTypeId}`,
          ),
          accounts.getRequiredSystemAccountInTransaction(
            transaction,
            tenant.id,
            'SETTLEMENT_CONVERSION_CLEARING',
          ),
          transaction
            .select({ id: assetDimensions.id })
            .from(assetDimensions)
            .where(
              and(
                eq(assetDimensions.tenantId, tenant.id),
                eq(assetDimensions.coinTypeId, centralBankCoinTypeId),
              ),
            )
            .then(([found]) => found!),
          transaction
            .select({ id: assetDimensions.id })
            .from(assetDimensions)
            .where(
              and(
                eq(assetDimensions.tenantId, tenant.id),
                eq(assetDimensions.coinTypeId, otherCoinTypeId),
              ),
            )
            .then(([found]) => found!),
        ]);
        return [coinInventory.id, clearing.id, coinDimension.id, otherCoinDimension.id] as const;
      });
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
    if (app !== undefined) await app.close();
  });

  it('locks the market rate and MAZNEH, receives only its coin type, posts its own coin dimension, and replays idempotently', async () => {
    const count = 2;
    const marketUnitPriceRial = 250_000_000n;
    const settledRial = BigInt(count) * marketUnitPriceRial;
    const request = {
      coinTypeId: centralBankCoinTypeId,
      count,
      marketUnitPriceRial: marketUnitPriceRial.toString(),
      quoteId,
      effectiveAt: effectiveAt.toISOString(),
    };
    const run = () =>
      idempotency.execute({
        tenantId: tenant.id,
        key: 'coin-settlement-1',
        request: { method: 'POST', path: `/parties/${partyId}/settlements/coins`, body: request },
        execute: async (transaction) => {
          const result = await settlementService.createInTransaction(transaction, {
            tenantId: tenant.id,
            partyId,
            coinTypeId: centralBankCoinTypeId,
            count,
            marketUnitPriceRial,
            quoteId,
            effectiveAt,
            createdBy: actorId,
          });
          return {
            status: 201,
            body: {
              settlementId: result.settlementId,
              ledgerTransactionId: result.ledgerTransactionId,
              inventoryMovementId: result.inventoryMovementId,
              settledRial: result.settledRial.toString(),
            },
          };
        },
      });

    const receivableBefore = await balances.getAccountBalances(tenant.id, receivableAccountId);
    const coinInventoryBefore = await movements.balance(tenant.id, 'COIN', centralBankCoinTypeId);
    const otherCoinInventoryBefore = await movements.balance(tenant.id, 'COIN', otherCoinTypeId);
    const first = await run();
    const replay = await run();

    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, response: first.response });
    expect(first.response.body.settledRial).toBe(settledRial.toString());

    const receivableAfter = await balances.getAccountBalances(tenant.id, receivableAccountId);
    expect(BigInt(receivableAfter.rial ?? '0') - BigInt(receivableBefore.rial ?? '0')).toBe(
      -settledRial,
    );
    expect(await movements.balance(tenant.id, 'COIN', centralBankCoinTypeId)).toBe(
      coinInventoryBefore + BigInt(count),
    );
    expect(await movements.balance(tenant.id, 'COIN', otherCoinTypeId)).toBe(
      otherCoinInventoryBefore,
    );

    const document = await withTenantTransaction(db, tenant.id, async (transaction) => {
      const [ledgerTransaction] = await transaction
        .select()
        .from(ledgerTransactions)
        .where(
          and(
            eq(ledgerTransactions.tenantId, tenant.id),
            eq(ledgerTransactions.id, first.response.body.ledgerTransactionId),
          ),
        );
      const lines = await transaction
        .select()
        .from(settlementLines)
        .where(eq(settlementLines.settlementId, first.response.body.settlementId));
      const entries = await transaction
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.transactionId, first.response.body.ledgerTransactionId));
      const [movement] = await transaction
        .select()
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, tenant.id),
            eq(inventoryMovements.id, first.response.body.inventoryMovementId),
          ),
        );
      return { ledgerTransaction, lines, entries, movement };
    });

    expect(document.ledgerTransaction).toMatchObject({ sourceType: 'SETTLEMENT' });
    expect(document.movement).toMatchObject({
      sourceType: 'SETTLEMENT',
      sourceId: first.response.body.settlementId,
      itemType: 'COIN',
      itemId: centralBankCoinTypeId,
      quantity: BigInt(count),
      dimensionId: coinDimensionId,
    });

    const coinLine = document.lines.find((line) => line.lineType === 'COIN');
    const rialLine = document.lines.find((line) => line.lineType === 'RIAL');
    expect(coinLine).toMatchObject({
      dimensionId: coinDimensionId,
      quantity: BigInt(count),
      lockedQuoteId: quoteId,
      lockedQuoteAmountRial: maznehRial,
      lockedConversionSnapshot: {
        marketUnitPriceRial: marketUnitPriceRial.toString(),
        goldRate1000Rial: expect.any(String),
      },
    });
    expect(rialLine).toMatchObject({
      quantity: settledRial,
      lockedQuoteId: quoteId,
      lockedQuoteAmountRial: maznehRial,
      lockedConversionSnapshot: {
        marketUnitPriceRial: marketUnitPriceRial.toString(),
        quoteObservedAt: expect.any(String),
      },
    });

    const coinEntries = document.entries.filter((entry) => entry.dimensionId === coinDimensionId);
    expect(coinEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: coinInventoryAccountId, quantity: BigInt(count) }),
        expect.objectContaining({ accountId: clearingAccountId, quantity: -BigInt(count) }),
      ]),
    );
    expect(document.entries.some((entry) => entry.dimensionId === otherCoinDimensionId)).toBe(
      false,
    );
    expect(document.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: receivableAccountId, quantity: -settledRial }),
        expect.objectContaining({ accountId: clearingAccountId, quantity: settledRial }),
      ]),
    );
  });

  it('rolls back the settlement, movement, ledger posting, and idempotency claim when the coin type is unavailable', async () => {
    const before = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      settlements: await transaction
        .select()
        .from(settlements)
        .where(eq(settlements.tenantId, tenant.id)),
      movements: await transaction
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.tenantId, tenant.id)),
      transactions: await transaction
        .select()
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.tenantId, tenant.id)),
    }));

    await expect(
      idempotency.execute({
        tenantId: tenant.id,
        key: 'coin-settlement-failure',
        request: {
          method: 'POST',
          path: `/parties/${partyId}/settlements/coins`,
          body: {
            coinTypeId: randomUUID(),
            count: 1,
            marketUnitPriceRial: '250000000',
            quoteId,
            effectiveAt: effectiveAt.toISOString(),
          },
        },
        execute: async (transaction) => {
          const created = await settlementService.createInTransaction(transaction, {
            tenantId: tenant.id,
            partyId,
            coinTypeId: randomUUID(),
            count: 1,
            marketUnitPriceRial: 250_000_000n,
            quoteId,
            effectiveAt,
            createdBy: actorId,
          });
          return { status: 201, body: { settlementId: created.settlementId } };
        },
      }),
    ).rejects.toThrow();

    const after = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      settlements: await transaction
        .select()
        .from(settlements)
        .where(eq(settlements.tenantId, tenant.id)),
      movements: await transaction
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.tenantId, tenant.id)),
      transactions: await transaction
        .select()
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.tenantId, tenant.id)),
      keys: await transaction
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.tenantId, tenant.id),
            eq(idempotencyRecords.key, 'coin-settlement-failure'),
          ),
        ),
    }));

    expect(after.settlements).toHaveLength(before.settlements.length);
    expect(after.movements).toHaveLength(before.movements.length);
    expect(after.transactions).toHaveLength(before.transactions.length);
    expect(after.keys).toHaveLength(0);
  });
});
