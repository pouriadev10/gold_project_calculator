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
import { PartiesService } from '../src/modules/parties/parties.service';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { GoldSettlementsService } from '../src/modules/settlement/gold-settlements.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
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

describe('gold settlement on a party rial balance (BE-046)', () => {
  const tenant = { id: '', slug: `gold-settlement-${randomUUID().slice(0, 12)}` };
  let effectiveAt = new Date();
  let app: INestApplicationContext;
  let db: Database;
  let idempotency: IdempotencyService;
  let settlementsService: GoldSettlementsService;
  let balances: AccountBalanceService;
  let movements: InventoryMovementsService;
  let actorId = '';
  let partyId = '';
  let quoteId = '';
  let receivableAccountId = '';
  let inventoryMeltedGoldAccountId = '';
  let clearingAccountId = '';

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
    settlementsService = app.get(GoldSettlementsService);
    balances = app.get(AccountBalanceService);
    movements = app.get(InventoryMovementsService);

    tenant.id = (
      await tenantService.create({ name: 'Gold settlement tenant', slug: tenant.slug })
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
          input: { type: 'CONSUMER', displayName: 'Gold-paying debtor' },
        }),
      )
    ).id;
    const partyAccounts = await accounts.ensurePartyAccounts({ tenantId: tenant.id, partyId });
    receivableAccountId = partyAccounts.receivable.id;
    inventoryMeltedGoldAccountId = (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        accounts.getRequiredSystemAccountInTransaction(
          transaction,
          tenant.id,
          'INVENTORY_MELTED_GOLD',
        ),
      )
    ).id;
    clearingAccountId = (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        accounts.getRequiredSystemAccountInTransaction(
          transaction,
          tenant.id,
          'SETTLEMENT_CONVERSION_CLEARING',
        ),
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

  it('normalizes karat to pure milligrams, locks the conversion, posts every dimension, moves inventory, and replays idempotently', async () => {
    const grossWeightMg = 8_000n;
    const fineness = 750;
    const expectedPureWeightMg = toPureMg(grossMg(grossWeightMg), karat(fineness));
    const request = {
      grossWeightMg: grossWeightMg.toString(),
      karat: fineness,
      quoteId,
      effectiveAt: effectiveAt.toISOString(),
    };
    const run = () =>
      idempotency.execute({
        tenantId: tenant.id,
        key: 'gold-settlement-1',
        request: { method: 'POST', path: `/parties/${partyId}/settlements/gold`, body: request },
        execute: async (transaction) => {
          const result = await settlementsService.createInTransaction(transaction, {
            tenantId: tenant.id,
            partyId,
            grossWeightMg,
            karat: fineness,
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
              pureWeightMg: result.pureWeightMg.toString(),
              settledRial: result.settledRial.toString(),
              goldRatePerGramRial: result.goldRatePerGramRial.toString(),
            },
          };
        },
      });

    const receivableBefore = await balances.getAccountBalances(tenant.id, receivableAccountId);
    const inventoryBefore = await movements.balance(tenant.id, 'MELTED_GOLD', null);
    const first = await run();
    const replay = await run();

    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, response: first.response });
    expect(first.response.body.pureWeightMg).toBe(expectedPureWeightMg.toString());

    const settledRial = BigInt(first.response.body.settledRial);
    const receivableAfter = await balances.getAccountBalances(tenant.id, receivableAccountId);
    const inventoryAfter = await movements.balance(tenant.id, 'MELTED_GOLD', null);
    expect(BigInt(receivableAfter.rial ?? '0') - BigInt(receivableBefore.rial ?? '0')).toBe(
      -settledRial,
    );
    expect(inventoryAfter - inventoryBefore).toBe(expectedPureWeightMg);

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
      itemType: 'MELTED_GOLD',
      itemId: null,
      quantity: expectedPureWeightMg,
    });

    const goldLine = document.lines.find((line) => line.lineType === 'GOLD');
    const rialLine = document.lines.find((line) => line.lineType === 'RIAL');
    expect(goldLine).toMatchObject({
      quantity: expectedPureWeightMg,
      lockedQuoteId: quoteId,
      lockedQuoteAmountRial: 100_000_000n,
      lockedConversionSnapshot: {
        goldRatePerGramRial: first.response.body.goldRatePerGramRial,
      },
    });
    expect(rialLine).toMatchObject({
      quantity: settledRial,
      lockedQuoteId: quoteId,
      lockedQuoteAmountRial: 100_000_000n,
      lockedConversionSnapshot: {
        goldRatePerGramRial: first.response.body.goldRatePerGramRial,
      },
    });

    expect(document.entries).toHaveLength(4);
    expect(document.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: inventoryMeltedGoldAccountId,
          quantity: expectedPureWeightMg,
        }),
        expect.objectContaining({ accountId: clearingAccountId, quantity: -expectedPureWeightMg }),
        expect.objectContaining({ accountId: receivableAccountId, quantity: -settledRial }),
        expect.objectContaining({ accountId: clearingAccountId, quantity: settledRial }),
      ]),
    );
  });

  it('rolls back the settlement, inventory movement, ledger posting, and idempotency claim when the party is unavailable', async () => {
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
        key: 'gold-settlement-failure',
        request: {
          method: 'POST',
          path: `/parties/${randomUUID()}/settlements/gold`,
          body: {
            grossWeightMg: '1',
            karat: 1000,
            quoteId,
            effectiveAt: effectiveAt.toISOString(),
          },
        },
        execute: async (transaction) => {
          const result = await settlementsService.createInTransaction(transaction, {
            tenantId: tenant.id,
            partyId: randomUUID(),
            grossWeightMg: 1n,
            karat: 1000,
            quoteId,
            effectiveAt,
            createdBy: actorId,
          });
          return {
            status: 201,
            body: {
              settlementId: result.settlementId,
              ledgerTransactionId: result.ledgerTransactionId,
            },
          };
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
            eq(idempotencyRecords.key, 'gold-settlement-failure'),
          ),
        ),
    }));

    expect(after.settlements).toHaveLength(before.settlements.length);
    expect(after.movements).toHaveLength(before.movements.length);
    expect(after.transactions).toHaveLength(before.transactions.length);
    expect(after.keys).toHaveLength(0);
  });
});
