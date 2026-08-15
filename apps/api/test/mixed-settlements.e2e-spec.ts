import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { grossMg, karat, toPureMg } from '@gold/core-calc';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { InventoryMovementsService } from '../src/modules/inventory/inventory-movements.service';
import { AccountBalanceService } from '../src/modules/ledger/account-balance.service';
import { LedgerAccountsService } from '../src/modules/ledger/ledger-accounts.service';
import { LedgerPostingService } from '../src/modules/ledger/ledger-posting.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { MixedSettlementsService } from '../src/modules/settlement/mixed-settlements.service';
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

describe('mixed settlement (BE-048)', () => {
  const tenant = { id: '', slug: `mixed-settlement-${randomUUID().slice(0, 12)}` };
  let effectiveAt = new Date();
  const creditRial = 25_000_000n;
  let app: INestApplicationContext;
  let db: Database;
  let idempotency: IdempotencyService;
  let settlementService: MixedSettlementsService;
  let balances: AccountBalanceService;
  let movements: InventoryMovementsService;
  let actorId = '';
  let partyId = '';
  let goldQuoteId = '';
  let coinQuoteId = '';
  let coinTypeId = '';
  let receivableAccountId = '';
  let payableAccountId = '';
  let cashAccountId = '';
  let goldInventoryAccountId = '';
  let coinInventoryAccountId = '';
  let clearingAccountId = '';
  let rialDimensionId = '';
  let goldDimensionId = '';
  let coinDimensionId = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
    const tenantService = app.get(TenantService);
    const users = app.get(UserService);
    const parties = app.get(PartiesService);
    const accounts = app.get(LedgerAccountsService);
    const posting = app.get(LedgerPostingService);
    const quotes = app.get(PriceQuotesService);
    idempotency = app.get(IdempotencyService);
    settlementService = app.get(MixedSettlementsService);
    balances = app.get(AccountBalanceService);
    movements = app.get(InventoryMovementsService);

    tenant.id = (
      await tenantService.create({ name: 'Mixed settlement tenant', slug: tenant.slug })
    ).id;
    effectiveAt = new Date();
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
          input: { type: 'CONSUMER', displayName: 'Mixed-paying debtor' },
        }),
      )
    ).id;
    const partyAccounts = await accounts.ensurePartyAccounts({ tenantId: tenant.id, partyId });
    receivableAccountId = partyAccounts.receivable.id;
    payableAccountId = partyAccounts.payable.id;

    coinTypeId = (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        transaction
          .select({ id: coinTypes.id })
          .from(coinTypes)
          .where(and(eq(coinTypes.tenantId, tenant.id), eq(coinTypes.code, 'GERAMI')))
          .then(([found]) => found!),
      )
    ).id;
    [cashAccountId, goldInventoryAccountId, coinInventoryAccountId, clearingAccountId] =
      await withTenantTransaction(db, tenant.id, async (transaction) => {
        const [cash, meltedGold, coinInventory, clearing] = await Promise.all([
          accounts.getRequiredSystemAccountInTransaction(transaction, tenant.id, 'CASH'),
          accounts.getRequiredSystemAccountInTransaction(
            transaction,
            tenant.id,
            'INVENTORY_MELTED_GOLD',
          ),
          accounts.getRequiredSystemAccountInTransaction(
            transaction,
            tenant.id,
            `INVENTORY_COIN:${coinTypeId}`,
          ),
          accounts.getRequiredSystemAccountInTransaction(
            transaction,
            tenant.id,
            'SETTLEMENT_CONVERSION_CLEARING',
          ),
        ]);
        return [cash.id, meltedGold.id, coinInventory.id, clearing.id] as const;
      });
    [rialDimensionId, goldDimensionId, coinDimensionId] = await withTenantTransaction(
      db,
      tenant.id,
      async (transaction) => {
        const [rial, gold, coin] = await Promise.all([
          transaction
            .select({ id: assetDimensions.id })
            .from(assetDimensions)
            .where(and(eq(assetDimensions.tenantId, tenant.id), eq(assetDimensions.code, 'RIAL')))
            .then(([found]) => found!),
          transaction
            .select({ id: assetDimensions.id })
            .from(assetDimensions)
            .where(and(eq(assetDimensions.tenantId, tenant.id), eq(assetDimensions.code, 'GOLD')))
            .then(([found]) => found!),
          transaction
            .select({ id: assetDimensions.id })
            .from(assetDimensions)
            .where(
              and(
                eq(assetDimensions.tenantId, tenant.id),
                eq(assetDimensions.coinTypeId, coinTypeId),
              ),
            )
            .then(([found]) => found!),
        ]);
        return [rial.id, gold.id, coin.id] as const;
      },
    );
    goldQuoteId = (
      await quotes.createManual({
        tenantId: tenant.id,
        quoteType: 'MAZNEH',
        amountRial: 100_000_000n,
        createdBy: actorId,
      })
    ).id;
    coinQuoteId = (
      await quotes.createManual({
        tenantId: tenant.id,
        quoteType: 'MAZNEH',
        amountRial: 101_000_000n,
        createdBy: actorId,
      })
    ).id;

    await posting.post({
      source: { tenantId: tenant.id, type: 'OPENING_BALANCE', id: randomUUID() },
      effectiveAt,
      description: 'Party credit opening balance',
      createdBy: actorId,
      entries: [
        { accountId: cashAccountId, dimensionId: rialDimensionId, quantity: creditRial },
        { accountId: payableAccountId, dimensionId: rialDimensionId, quantity: -creditRial },
      ],
    });
  });

  afterAll(async () => {
    if (tenant.id !== '') await db.delete(tenants).where(eq(tenants.id, tenant.id));
    if (app !== undefined) await app.close();
  });

  it('finalizes cash, gold, coin, and credit lines as one balanced settlement with independently locked conversions', async () => {
    const cashRial = 100_000_000n;
    const grossWeightMg = 2_000n;
    const goldKarat = 1_000;
    const pureWeightMg = toPureMg(grossMg(grossWeightMg), karat(goldKarat));
    const coinCount = 1;
    const marketUnitPriceRial = 150_000_000n;
    const request = {
      effectiveAt: effectiveAt.toISOString(),
      lines: [
        { type: 'RIAL' as const, amountRial: cashRial.toString() },
        {
          type: 'GOLD' as const,
          grossWeightMg: grossWeightMg.toString(),
          karat: goldKarat,
          quoteId: goldQuoteId,
        },
        {
          type: 'COIN' as const,
          coinTypeId,
          count: coinCount,
          marketUnitPriceRial: marketUnitPriceRial.toString(),
          quoteId: coinQuoteId,
        },
        { type: 'CREDIT' as const, amountRial: creditRial.toString() },
      ],
    };
    const run = () =>
      idempotency.execute({
        tenantId: tenant.id,
        key: 'mixed-settlement-1',
        request: { method: 'POST', path: `/parties/${partyId}/settlements/mixed`, body: request },
        execute: async (transaction) => {
          const result = await settlementService.createInTransaction(transaction, {
            tenantId: tenant.id,
            partyId,
            effectiveAt,
            createdBy: actorId,
            lines: [
              { type: 'RIAL', amountRial: cashRial },
              { type: 'GOLD', grossWeightMg, karat: goldKarat, quoteId: goldQuoteId },
              {
                type: 'COIN',
                coinTypeId,
                count: coinCount,
                marketUnitPriceRial,
                quoteId: coinQuoteId,
              },
              { type: 'CREDIT', amountRial: creditRial },
            ],
          });
          return {
            status: 201,
            body: {
              settlementId: result.settlementId,
              ledgerTransactionId: result.ledgerTransactionId,
              totalSettledRial: result.totalSettledRial.toString(),
            },
          };
        },
      });

    const receivableBefore = await balances.getAccountBalances(tenant.id, receivableAccountId);
    const payableBefore = await balances.getAccountBalances(tenant.id, payableAccountId);
    const cashBefore = await balances.getAccountBalances(tenant.id, cashAccountId);
    const goldBefore = await movements.balance(tenant.id, 'MELTED_GOLD', null);
    const coinBefore = await movements.balance(tenant.id, 'COIN', coinTypeId);
    const first = await run();
    const replay = await run();

    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, response: first.response });

    const totalSettledRial = BigInt(first.response.body.totalSettledRial);
    const receivableAfter = await balances.getAccountBalances(tenant.id, receivableAccountId);
    const payableAfter = await balances.getAccountBalances(tenant.id, payableAccountId);
    const cashAfter = await balances.getAccountBalances(tenant.id, cashAccountId);
    expect(BigInt(receivableAfter.rial ?? '0') - BigInt(receivableBefore.rial ?? '0')).toBe(
      -totalSettledRial,
    );
    expect(BigInt(payableAfter.rial ?? '0') - BigInt(payableBefore.rial ?? '0')).toBe(creditRial);
    expect(BigInt(cashAfter.rial ?? '0') - BigInt(cashBefore.rial ?? '0')).toBe(cashRial);
    expect(await movements.balance(tenant.id, 'MELTED_GOLD', null)).toBe(goldBefore + pureWeightMg);
    expect(await movements.balance(tenant.id, 'COIN', coinTypeId)).toBe(
      coinBefore + BigInt(coinCount),
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
      const recordedMovements = await transaction
        .select()
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, tenant.id),
            eq(inventoryMovements.sourceType, 'SETTLEMENT'),
            eq(inventoryMovements.sourceId, first.response.body.settlementId),
          ),
        );
      return { ledgerTransaction, lines, entries, recordedMovements };
    });

    expect(document.ledgerTransaction).toMatchObject({ sourceType: 'SETTLEMENT' });
    expect(document.lines).toHaveLength(6);
    expect(document.recordedMovements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemType: 'MELTED_GOLD', quantity: pureWeightMg }),
        expect.objectContaining({
          itemType: 'COIN',
          itemId: coinTypeId,
          quantity: BigInt(coinCount),
        }),
      ]),
    );

    const goldLine = document.lines.find((line) => line.lineType === 'GOLD');
    const coinLine = document.lines.find((line) => line.lineType === 'COIN');
    const creditLine = document.lines.find((line) => line.lineType === 'CREDIT');
    expect(goldLine).toMatchObject({
      lockedQuoteId: goldQuoteId,
      lockedConversionSnapshot: { goldRatePerGramRial: expect.any(String) },
    });
    expect(coinLine).toMatchObject({
      lockedQuoteId: coinQuoteId,
      lockedConversionSnapshot: { marketUnitPriceRial: marketUnitPriceRial.toString() },
    });
    expect(creditLine).toMatchObject({
      sourceAccountId: receivableAccountId,
      destinationAccountId: payableAccountId,
      dimensionId: rialDimensionId,
      quantity: creditRial,
    });

    const totalsByDimension = new Map<string, bigint>();
    for (const entry of document.entries) {
      totalsByDimension.set(
        entry.dimensionId,
        (totalsByDimension.get(entry.dimensionId) ?? 0n) + entry.quantity,
      );
    }
    for (const total of totalsByDimension.values()) {
      expect(total).toBe(0n);
    }
    expect(document.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: cashAccountId,
          dimensionId: rialDimensionId,
          quantity: cashRial,
        }),
        expect.objectContaining({
          accountId: goldInventoryAccountId,
          dimensionId: goldDimensionId,
          quantity: pureWeightMg,
        }),
        expect.objectContaining({
          accountId: coinInventoryAccountId,
          dimensionId: coinDimensionId,
          quantity: BigInt(coinCount),
        }),
        expect.objectContaining({
          accountId: clearingAccountId,
          dimensionId: goldDimensionId,
          quantity: -pureWeightMg,
        }),
        expect.objectContaining({
          accountId: clearingAccountId,
          dimensionId: coinDimensionId,
          quantity: -BigInt(coinCount),
        }),
      ]),
    );
  });

  it('rolls back every line and the idempotency claim when one coin type is invalid', async () => {
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
        key: 'mixed-settlement-failure',
        request: {
          method: 'POST',
          path: `/parties/${partyId}/settlements/mixed`,
          body: {
            effectiveAt: effectiveAt.toISOString(),
            lines: [
              { type: 'RIAL', amountRial: '1' },
              {
                type: 'COIN',
                coinTypeId: randomUUID(),
                count: 1,
                marketUnitPriceRial: '1',
                quoteId: coinQuoteId,
              },
            ],
          },
        },
        execute: async (transaction) => {
          const created = await settlementService.createInTransaction(transaction, {
            tenantId: tenant.id,
            partyId,
            effectiveAt,
            createdBy: actorId,
            lines: [
              { type: 'RIAL', amountRial: 1n },
              {
                type: 'COIN',
                coinTypeId: randomUUID(),
                count: 1,
                marketUnitPriceRial: 1n,
                quoteId: coinQuoteId,
              },
            ],
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
            eq(idempotencyRecords.key, 'mixed-settlement-failure'),
          ),
        ),
    }));

    expect(after.settlements).toHaveLength(before.settlements.length);
    expect(after.movements).toHaveLength(before.movements.length);
    expect(after.transactions).toHaveLength(before.transactions.length);
    expect(after.keys).toHaveLength(0);
  });
});
