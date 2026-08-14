import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AccountBalanceService } from '../src/modules/ledger/account-balance.service';
import { LedgerAccountsService } from '../src/modules/ledger/ledger-accounts.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import { RialSettlementsService } from '../src/modules/settlement/rial-settlements.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import { idempotencyRecords, ledgerTransactions, settlements, tenants } from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { IdempotencyService } from '../src/platform/idempotency/idempotency.service';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { UserService } from '../src/platform/users/user.service';
import type { Database } from '../src/platform/database/connect';
import type { INestApplicationContext } from '@nestjs/common';

describe('rial settlement on party balance (BE-045)', () => {
  const tenant = { id: '', slug: `rial-settlement-${randomUUID().slice(0, 12)}` };
  let app: INestApplicationContext;
  let db: Database;
  let idempotency: IdempotencyService;
  let rialSettlements: RialSettlementsService;
  let balances: AccountBalanceService;
  let actorId = '';
  let partyId = '';
  let receivableAccountId = '';
  const effectiveAt = new Date();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
    const tenantService = app.get(TenantService);
    const users = app.get(UserService);
    const parties = app.get(PartiesService);
    const ledgerAccounts = app.get(LedgerAccountsService);
    idempotency = app.get(IdempotencyService);
    rialSettlements = app.get(RialSettlementsService);
    balances = app.get(AccountBalanceService);

    tenant.id = (await tenantService.create({ name: 'Rial settlement tenant', slug: tenant.slug })).id;
    actorId = (
      await users.create({ email: `${randomUUID().slice(0, 12)}@example.com`, displayName: 'Cashier' })
    ).id;
    partyId = (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        parties.createInTransaction(transaction, {
          tenantId: tenant.id,
          actorUserId: actorId,
          input: { type: 'CONSUMER', displayName: 'Debtor' },
        }),
      )
    ).id;
    receivableAccountId = (await ledgerAccounts.ensurePartyAccounts({ tenantId: tenant.id, partyId }))
      .receivable.id;
  });

  afterAll(async () => {
    if (tenant.id !== '') await db.delete(tenants).where(eq(tenants.id, tenant.id));
    await app.close();
  });

  it('reduces the party receivable, posts a balanced rial-only ledger entry, and replays idempotently', async () => {
    const request = { amountRial: '100000000', effectiveAt: effectiveAt.toISOString() };
    const run = () =>
      idempotency.execute({
        tenantId: tenant.id,
        key: 'rial-settlement-1',
        request: { method: 'POST', path: `/parties/${partyId}/settlements/rial`, body: request },
        execute: async (transaction) => {
          const result = await rialSettlements.createInTransaction(transaction, {
            tenantId: tenant.id,
            partyId,
            amountRial: 100_000_000n,
            effectiveAt,
            createdBy: actorId,
          });
          return {
            status: 201,
            body: { settlementId: result.settlementId, ledgerTransactionId: result.ledgerTransactionId },
          };
        },
      });

    const before = await balances.getAccountBalances(tenant.id, receivableAccountId);
    const first = await run();
    const replay = await run();
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, response: first.response });

    const after = await balances.getAccountBalances(tenant.id, receivableAccountId);
    expect(BigInt(after.rial ?? '0') - BigInt(before.rial ?? '0')).toBe(-100_000_000n);

    const [ledgerTransaction] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(ledgerTransactions)
        .where(and(eq(ledgerTransactions.tenantId, tenant.id), eq(ledgerTransactions.sourceType, 'SETTLEMENT'))),
    );
    expect(ledgerTransaction!.id).toBe(first.response.body.ledgerTransactionId);

    const [settlementRow] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction.select().from(settlements).where(eq(settlements.tenantId, tenant.id)),
    );
    expect(settlementRow!.status).toBe('FINALIZED');
  });

  it('rolls back the draft settlement and idempotency claim when the party does not exist', async () => {
    const before = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction.select().from(settlements).where(eq(settlements.tenantId, tenant.id)),
    );

    await expect(
      idempotency.execute({
        tenantId: tenant.id,
        key: 'rial-settlement-failure',
        request: {
          method: 'POST',
          path: `/parties/${randomUUID()}/settlements/rial`,
          body: { amountRial: '1', effectiveAt: effectiveAt.toISOString() },
        },
        execute: async (transaction) => {
          const result = await rialSettlements.createInTransaction(transaction, {
            tenantId: tenant.id,
            partyId: randomUUID(),
            amountRial: 1n,
            effectiveAt,
            createdBy: actorId,
          });
          return {
            status: 201,
            body: { settlementId: result.settlementId, ledgerTransactionId: result.ledgerTransactionId },
          };
        },
      }),
    ).rejects.toThrow();

    const after = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      settlements: await transaction.select().from(settlements).where(eq(settlements.tenantId, tenant.id)),
      keys: await transaction
        .select()
        .from(idempotencyRecords)
        .where(
          and(eq(idempotencyRecords.tenantId, tenant.id), eq(idempotencyRecords.key, 'rial-settlement-failure')),
        ),
    }));
    expect(after.settlements).toHaveLength(before.length);
    expect(after.keys).toHaveLength(0);
  });
});
