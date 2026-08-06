import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import {
  LedgerPostingAccountNotFoundError,
  UnbalancedLedgerPostingError,
} from '../src/modules/ledger/ledger-posting.errors';
import {
  LedgerPostingService,
  type LedgerPostingInput,
} from '../src/modules/ledger/ledger-posting.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
  assetDimensions,
  auditLogs,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  tenants,
} from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import type { INestApplicationContext } from '@nestjs/common';
import type { Database } from '../src/platform/database/connect';

type PostingTargets = {
  readonly cashAccountId: string;
  readonly clearingAccountId: string;
  readonly goldDimensionId: string;
  readonly jewelryInventoryAccountId: string;
  readonly rialDimensionId: string;
};

/** Ledger posting service — BE-034. Runs against a real PostgreSQL database. */
describe('LedgerPostingService (BE-034)', () => {
  let app: INestApplicationContext;
  let db: Database;
  let postingService: LedgerPostingService;
  let tenantService: TenantService;
  const tenantIds: string[] = [];

  async function createTenant(label = 'ثبت دفتر کل') {
    const tenant = await tenantService.create({
      name: label,
      slug: `ledger-posting-${randomUUID().slice(0, 12)}`,
    });
    tenantIds.push(tenant.id);
    return tenant;
  }

  async function getPostingTargets(tenantId: string): Promise<PostingTargets> {
    return withTenantTransaction(db, tenantId, async (transaction) => {
      const accounts = await transaction
        .select({ id: ledgerAccounts.id, systemKey: ledgerAccounts.systemKey })
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.tenantId, tenantId));
      const dimensions = await transaction
        .select({ id: assetDimensions.id, code: assetDimensions.code })
        .from(assetDimensions)
        .where(eq(assetDimensions.tenantId, tenantId));
      const accountsByKey = new Map(
        accounts.flatMap((account) =>
          account.systemKey === null ? [] : [[account.systemKey, account.id] as const],
        ),
      );
      const dimensionsByCode = new Map(dimensions.map((dimension) => [dimension.code, dimension.id]));
      const cashAccountId = accountsByKey.get('CASH');
      const clearingAccountId = accountsByKey.get('SETTLEMENT_CONVERSION_CLEARING');
      const jewelryInventoryAccountId = accountsByKey.get('INVENTORY_JEWELRY');
      const rialDimensionId = dimensionsByCode.get('RIAL');
      const goldDimensionId = dimensionsByCode.get('GOLD');

      if (
        !cashAccountId ||
        !clearingAccountId ||
        !jewelryInventoryAccountId ||
        !rialDimensionId ||
        !goldDimensionId
      ) {
        throw new Error('حساب‌ها یا ابعاد لازم برای posting seed نشده‌اند.');
      }

      return {
        cashAccountId,
        clearingAccountId,
        jewelryInventoryAccountId,
        rialDimensionId,
        goldDimensionId,
      };
    });
  }

  function settlementPosting(
    tenantId: string,
    targets: PostingTargets,
    sourceId = randomUUID(),
  ): LedgerPostingInput {
    const conversionSnapshot = {
      quoteRialPerGram1000: '123456',
      capturedAt: '2026-08-06T00:00:00.000Z',
    } as const;

    return {
      source: { tenantId, type: 'SETTLEMENT', id: sourceId },
      effectiveAt: new Date('2026-08-06T00:00:00.000Z'),
      description: 'تسویه‌ی آزمایشی با نرخ قفل‌شده',
      entries: [
        {
          accountId: targets.cashAccountId,
          dimensionId: targets.rialDimensionId,
          quantity: 7n,
          metadata: { conversionSnapshot },
        },
        {
          accountId: targets.clearingAccountId,
          dimensionId: targets.rialDimensionId,
          quantity: -7n,
          metadata: { conversionSnapshot },
        },
        {
          accountId: targets.clearingAccountId,
          dimensionId: targets.goldDimensionId,
          quantity: 3n,
          metadata: { conversionSnapshot },
        },
        {
          accountId: targets.jewelryInventoryAccountId,
          dimensionId: targets.goldDimensionId,
          quantity: -3n,
          metadata: { conversionSnapshot },
        },
      ],
    };
  }

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = app.get<Database>(DRIZZLE);
    postingService = app.get(LedgerPostingService);
    tenantService = app.get(TenantService);
  });

  afterAll(async () => {
    for (const tenantId of tenantIds) {
      await db.delete(ledgerEntries).where(eq(ledgerEntries.tenantId, tenantId));
      await db.delete(ledgerTransactions).where(eq(ledgerTransactions.tenantId, tenantId));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await app.close();
  });

  it('posting متوازن چندبُعدی را همراه source و snapshot قفل‌شده atomically ثبت می‌کند', async () => {
    const tenant = await createTenant();
    const targets = await getPostingTargets(tenant.id);
    const input = settlementPosting(tenant.id, targets);

    const posted = await postingService.post(input);

    expect(posted.transaction).toMatchObject({
      tenantId: tenant.id,
      sourceType: 'SETTLEMENT',
      sourceId: input.source.id,
      description: input.description,
    });
    expect(posted.entries).toHaveLength(input.entries.length);
    expect(posted.entries.every((entry) => entry.transactionId === posted.transaction.id)).toBe(true);
    expect(posted.entries.map((entry) => entry.quantity)).toEqual([7n, -7n, 3n, -3n]);
    expect(posted.entries.every((entry) => entry.metadata === null || typeof entry.metadata === 'object')).toBe(
      true,
    );

    const saved = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      ledgerTransactions: await transaction
        .select()
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.id, posted.transaction.id)),
      ledgerEntries: await transaction
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.transactionId, posted.transaction.id)),
      audit: await transaction
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenant.id),
            eq(auditLogs.action, 'LEDGER_POSTED'),
            eq(auditLogs.entityId, posted.transaction.id),
          ),
        ),
    }));

    expect(saved.ledgerTransactions).toHaveLength(1);
    expect(saved.ledgerEntries).toHaveLength(input.entries.length);
    expect(saved.audit).toHaveLength(1);
    expect(saved.ledgerEntries[0]?.metadata).toEqual({
      conversionSnapshot: {
        quoteRialPerGram1000: '123456',
        capturedAt: '2026-08-06T00:00:00.000Z',
      },
    });
  });

  it('posting نامتوازن را پیش از insert رد می‌کند', async () => {
    const tenant = await createTenant();
    const targets = await getPostingTargets(tenant.id);
    const sourceId = randomUUID();
    const input = settlementPosting(tenant.id, targets, sourceId);
    const [firstEntry] = input.entries;
    if (!firstEntry) {
      throw new Error('entry آزمایشی ساخته نشد.');
    }

    await expect(
      postingService.post({ ...input, entries: [firstEntry] }),
    ).rejects.toBeInstanceOf(UnbalancedLedgerPostingError);

    const transactions = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select({ id: ledgerTransactions.id })
        .from(ledgerTransactions)
        .where(
          and(
            eq(ledgerTransactions.tenantId, tenant.id),
            eq(ledgerTransactions.sourceId, sourceId),
          ),
        ),
    );
    expect(transactions).toEqual([]);
  });

  it('account مستأجر دیگر را رد می‌کند و هیچ سند نیمه‌کاره‌ای نمی‌سازد', async () => {
    const tenantA = await createTenant('ثبت دفتر کل A');
    const tenantB = await createTenant('ثبت دفتر کل B');
    const targetsA = await getPostingTargets(tenantA.id);
    const targetsB = await getPostingTargets(tenantB.id);
    const sourceId = randomUUID();
    const input = settlementPosting(tenantA.id, targetsA, sourceId);
    const [firstEntry, ...otherEntries] = input.entries;
    if (!firstEntry) {
      throw new Error('entry آزمایشی ساخته نشد.');
    }

    await expect(
      postingService.post({
        ...input,
        entries: [{ ...firstEntry, accountId: targetsB.cashAccountId }, ...otherEntries],
      }),
    ).rejects.toBeInstanceOf(LedgerPostingAccountNotFoundError);

    const transactions = await withTenantTransaction(db, tenantA.id, (transaction) =>
      transaction
        .select({ id: ledgerTransactions.id })
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.sourceId, sourceId)),
    );
    expect(transactions).toEqual([]);
  });

  it('postInTransaction با rollback سند مبدأ، header و entryها را هم rollback می‌کند', async () => {
    const tenant = await createTenant();
    const targets = await getPostingTargets(tenant.id);
    const sourceId = randomUUID();
    const input = settlementPosting(tenant.id, targets, sourceId);

    await expect(
      withTenantTransaction(db, tenant.id, async (transaction) => {
        await postingService.postInTransaction(transaction, input);
        throw new Error('سند مبدأ نهایی نشد');
      }),
    ).rejects.toThrow('سند مبدأ نهایی نشد');

    const rolledBack = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      transactions: await transaction
        .select({ id: ledgerTransactions.id })
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.sourceId, sourceId)),
      entries: await transaction
        .select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.tenantId, tenant.id)),
      audit: await transaction
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenant.id),
            eq(auditLogs.action, 'LEDGER_POSTED'),
          ),
        ),
    }));
    expect(rolledBack.transactions).toEqual([]);
    expect(rolledBack.entries).toEqual([]);
    expect(rolledBack.audit).toEqual([]);
  });

  it('service مسیر update/delete برای دفتر کل ندارد', () => {
    const methods = Object.getOwnPropertyNames(LedgerPostingService.prototype);

    expect(methods.some((name) => /^(update|delete|remove)/u.test(name))).toBe(false);
  });
});
