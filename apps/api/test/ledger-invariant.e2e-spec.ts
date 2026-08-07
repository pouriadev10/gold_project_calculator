import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import fc from 'fast-check';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { UnbalancedLedgerPostingError } from '../src/modules/ledger/ledger-posting.errors';
import { LedgerPostingService } from '../src/modules/ledger/ledger-posting.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
  assetDimensions,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
} from '../src/platform/database/schema';
import {
  APP_DATABASE_ROLE,
  TENANT_SETTING,
  withTenantTransaction,
} from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import type { INestApplicationContext } from '@nestjs/common';
import type { Database } from '../src/platform/database/connect';
import type { LedgerPostingEntryInput } from '../src/modules/ledger/ledger-posting.service';
import type { PoolClient } from 'pg';

/**
 * ناوردای دفتر کل چندواحدی با fast-check — BE-035.
 *
 * `seed` روی هر `fc.assert` صریح و ثابت است. بدون آن، هر اجرای CI مقادیر
 * تصادفی متفاوتی می‌سازد و «deterministic و قابل تکرار» تسک نقض می‌شود —
 * یک اجرای سبز امروز چیزی درباره‌ی فردا اثبات نمی‌کند.
 *
 * حساب‌ها و ابعاد از chart واقعیِ seed‌شده‌ی همان tenant گرفته می‌شوند
 * (BE-030/BE-031)، نه UUID ساختگی؛ فقط combinationها و quantityها تصادفی‌اند.
 * سرویس هیچ قاعده‌ای درباره‌ی «کدام حساب با کدام بُعد» ندارد — این دقیقاً
 * همان چیزی است که این تست می‌خواهد اثبات کند: ناوردا صرفاً یک خاصیت ریاضی
 * روی quantityهای هر بُعد است، نه یک قاعده‌ی معنایی حساب‌داری.
 */
describe('ناوردای دفتر کل چندواحدی — Property-Based (BE-035)', () => {
  const SEED = 424242;
  const NUM_RUNS = 200;
  const QUANTITY_BOUND = 1_000_000_000_000n;

  let app: INestApplicationContext;
  let db: Database;
  let postingService: LedgerPostingService;
  let tenantService: TenantService;
  let tenantId = '';
  let accountIds: string[] = [];
  let dimensionIds: string[] = [];
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://gold:gold@localhost:5432/gold_test',
  });

  async function asRuntimeTenant<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${APP_DATABASE_ROLE}`);
      await client.query('SELECT set_config($1, $2, true)', [TENANT_SETTING, tenantId]);

      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = app.get<Database>(DRIZZLE);
    postingService = app.get(LedgerPostingService);
    tenantService = app.get(TenantService);

    const tenant = await tenantService.create({
      name: 'ناوردای دفتر کل',
      slug: `ledger-invariant-${randomUUID().slice(0, 12)}`,
    });
    tenantId = tenant.id;

    const [accounts, dimensions] = await Promise.all([
      withTenantTransaction(db, tenantId, (transaction) =>
        transaction
          .select({ id: ledgerAccounts.id })
          .from(ledgerAccounts)
          .where(eq(ledgerAccounts.tenantId, tenantId)),
      ),
      withTenantTransaction(db, tenantId, (transaction) =>
        transaction
          .select({ id: assetDimensions.id })
          .from(assetDimensions)
          .where(eq(assetDimensions.tenantId, tenantId)),
      ),
    ]);
    accountIds = accounts.map((account) => account.id);
    dimensionIds = dimensions.map((dimension) => dimension.id);

    if (accountIds.length < 2 || dimensionIds.length < 3) {
      throw new Error('حساب‌ها یا ابعاد کافی برای آزمون ناوردا seed نشده‌اند.');
    }
  });

  afterAll(async () => {
    if (tenantId !== '') {
      await pool.query('DELETE FROM ledger_entries WHERE tenant_id = $1', [tenantId]);
      await pool.query('DELETE FROM ledger_transactions WHERE tenant_id = $1', [tenantId]);
      await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    }
    await app.close();
    await pool.end();
  });

  const accountIndexArb = (): fc.Arbitrary<number> => fc.nat({ max: accountIds.length - 1 });
  const freeQuantityArb = (): fc.Arbitrary<bigint> =>
    fc.bigInt({ min: -QUANTITY_BOUND, max: QUANTITY_BOUND }).filter((quantity) => quantity !== 0n);
  const freeRecordArb = (): fc.Arbitrary<{ accountIndex: number; quantity: bigint }> =>
    fc.record({ accountIndex: accountIndexArb(), quantity: freeQuantityArb() });

  /**
   * یک entry متعادل‌کننده‌ی انتهایی اضافه می‌کند تا مجموع دقیقاً صفر شود.
   * اگر خودِ ردیف‌های آزاد از قبل صفر جمع شده باشند، آن entry هم صفر
   * می‌شود که مجاز نیست — `sum` را برمی‌گرداند تا فراخوان با `fc.pre` رد کند.
   */
  function balanceOneDimension(
    dimensionId: string,
    freeRecords: readonly { accountIndex: number; quantity: bigint }[],
    balancingAccountIndex: number,
  ): { entries: LedgerPostingEntryInput[]; sum: bigint } {
    const sum = freeRecords.reduce((total, record) => total + record.quantity, 0n);
    const entries: LedgerPostingEntryInput[] = [
      ...freeRecords.map((record) => ({
        accountId: accountIds[record.accountIndex]!,
        dimensionId,
        quantity: record.quantity,
      })),
      { accountId: accountIds[balancingAccountIndex]!, dimensionId, quantity: -sum },
    ];
    return { entries, sum };
  }

  async function totalsByTransactions(transactionIds: readonly string[]): Promise<Map<string, bigint>> {
    const rows = await withTenantTransaction(db, tenantId, (transaction) =>
      transaction
        .select({
          accountId: ledgerEntries.accountId,
          dimensionId: ledgerEntries.dimensionId,
          quantity: ledgerEntries.quantity,
        })
        .from(ledgerEntries)
        .where(inArray(ledgerEntries.transactionId, [...transactionIds])),
    );
    const totals = new Map<string, bigint>();
    for (const row of rows) {
      const key = `${row.accountId}:${row.dimensionId}`;
      totals.set(key, (totals.get(key) ?? 0n) + row.quantity);
    }
    return totals;
  }

  // ۲۰۰ اجرای هرکدام چند رفت‌وبرگشت واقعی به PostgreSQL دارد؛ پیش‌فرض ۵
  // ثانیه‌ی vitest برای این حجم کافی نیست — timeout صریح، نه کاهش numRuns.
  it('تراکنش تک‌بُعدی تصادفی همیشه با مجموع صفر در دیتابیس ثبت می‌شود', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: dimensionIds.length - 1 }),
        fc.array(freeRecordArb(), { minLength: 1, maxLength: 5 }),
        accountIndexArb(),
        async (dimensionIndex, freeRecords, balancingAccountIndex) => {
          const dimensionId = dimensionIds[dimensionIndex]!;
          const { entries, sum } = balanceOneDimension(dimensionId, freeRecords, balancingAccountIndex);
          fc.pre(sum !== 0n);

          const posted = await postingService.post({
            source: { tenantId, type: 'SETTLEMENT', id: randomUUID() },
            effectiveAt: new Date(),
            description: 'ناوردا — تک‌بُعدی',
            entries,
          });

          const totals = await totalsByTransactions([posted.transaction.id]);
          expect([...totals.values()].reduce((total, quantity) => total + quantity, 0n)).toBe(0n);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED },
    );
  }, 60_000);

  it('تراکنش چندبُعدی تصادفی (ریال، طلا، چند نوع سکه) هر بُعد را مستقل صفر می‌کند', async () => {
    const maxDimensions = Math.min(4, dimensionIds.length);

    await fc.assert(
      fc.asyncProperty(
        fc.subarray(dimensionIds, { minLength: 2, maxLength: maxDimensions }),
        fc.array(fc.array(freeRecordArb(), { minLength: 1, maxLength: 4 }), {
          minLength: maxDimensions,
          maxLength: maxDimensions,
        }),
        fc.array(accountIndexArb(), { minLength: maxDimensions, maxLength: maxDimensions }),
        async (chosenDimensions, freeRecordGroups, balancingIndices) => {
          const perDimension = chosenDimensions.map((dimensionId, index) =>
            balanceOneDimension(dimensionId, freeRecordGroups[index]!, balancingIndices[index]!),
          );
          fc.pre(perDimension.every(({ sum }) => sum !== 0n));

          const entries = perDimension.flatMap(({ entries: dimensionEntries }) => dimensionEntries);
          const posted = await postingService.post({
            source: { tenantId, type: 'SETTLEMENT', id: randomUUID() },
            effectiveAt: new Date(),
            description: 'ناوردا — چندبُعدی',
            entries,
          });

          const rows = await withTenantTransaction(db, tenantId, (transaction) =>
            transaction
              .select({ dimensionId: ledgerEntries.dimensionId, quantity: ledgerEntries.quantity })
              .from(ledgerEntries)
              .where(eq(ledgerEntries.transactionId, posted.transaction.id)),
          );
          const totalsByDimension = new Map<string, bigint>();
          for (const row of rows) {
            totalsByDimension.set(row.dimensionId, (totalsByDimension.get(row.dimensionId) ?? 0n) + row.quantity);
          }
          expect(totalsByDimension.size).toBe(chosenDimensions.length);
          for (const dimensionId of chosenDimensions) {
            expect(totalsByDimension.get(dimensionId)).toBe(0n);
          }
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED + 1 },
    );
  }, 60_000);

  it('reversal: ثبت یک سند و نقیض دقیق آن، اثر خالص را روی هر حساب و بُعد صفر می‌کند', async () => {
    const maxDimensions = Math.min(3, dimensionIds.length);

    await fc.assert(
      fc.asyncProperty(
        fc.subarray(dimensionIds, { minLength: 1, maxLength: maxDimensions }),
        fc.array(fc.array(freeRecordArb(), { minLength: 1, maxLength: 3 }), {
          minLength: maxDimensions,
          maxLength: maxDimensions,
        }),
        fc.array(accountIndexArb(), { minLength: maxDimensions, maxLength: maxDimensions }),
        async (chosenDimensions, freeRecordGroups, balancingIndices) => {
          const perDimension = chosenDimensions.map((dimensionId, index) =>
            balanceOneDimension(dimensionId, freeRecordGroups[index]!, balancingIndices[index]!),
          );
          fc.pre(perDimension.every(({ sum }) => sum !== 0n));

          const forwardEntries = perDimension.flatMap(({ entries }) => entries);
          const reverseEntries = forwardEntries.map((entry) => ({
            ...entry,
            quantity: -entry.quantity,
          }));

          const forward = await postingService.post({
            source: { tenantId, type: 'SETTLEMENT', id: randomUUID() },
            effectiveAt: new Date(),
            description: 'ناوردا — رفت',
            entries: forwardEntries,
          });
          const reverse = await postingService.post({
            source: { tenantId, type: 'SETTLEMENT', id: randomUUID() },
            effectiveAt: new Date(),
            description: 'ناوردا — برگشت',
            entries: reverseEntries,
          });

          expect(forward.transaction.id).not.toBe(reverse.transaction.id);

          const netByAccountDimension = await totalsByTransactions([
            forward.transaction.id,
            reverse.transaction.id,
          ]);
          expect([...netByAccountDimension.values()].every((total) => total === 0n)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED + 2 },
    );
  }, 90_000);

  it('تراکنش نامتوازن عمدی هرگز از سرویس عبور نمی‌کند و چیزی ثبت نمی‌شود', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: dimensionIds.length - 1 }),
        fc.array(freeRecordArb(), { minLength: 1, maxLength: 5 }),
        async (dimensionIndex, freeRecords) => {
          const dimensionId = dimensionIds[dimensionIndex]!;
          const sum = freeRecords.reduce((total, record) => total + record.quantity, 0n);
          // عمداً entry متعادل‌کننده اضافه نمی‌شود — همین «نامتوازن» را می‌سازد.
          fc.pre(sum !== 0n);

          const sourceId = randomUUID();
          const entries: LedgerPostingEntryInput[] = freeRecords.map((record) => ({
            accountId: accountIds[record.accountIndex]!,
            dimensionId,
            quantity: record.quantity,
          }));

          await expect(
            postingService.post({
              source: { tenantId, type: 'SETTLEMENT', id: sourceId },
              effectiveAt: new Date(),
              description: 'ناوردا — نامتوازن',
              entries,
            }),
          ).rejects.toBeInstanceOf(UnbalancedLedgerPostingError);

          const persisted = await withTenantTransaction(db, tenantId, (transaction) =>
            transaction
              .select({ id: ledgerTransactions.id })
              .from(ledgerTransactions)
              .where(eq(ledgerTransactions.sourceId, sourceId)),
          );
          expect(persisted).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED + 3 },
    );
  });

  it('حتی با SQL مستقیم زیر نقش runtime، تراکنش نامتوازن در commit رد و rollback می‌شود', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: dimensionIds.length - 1 }),
        fc.array(freeRecordArb(), { minLength: 1, maxLength: 5 }),
        async (dimensionIndex, freeRecords) => {
          const dimensionId = dimensionIds[dimensionIndex]!;
          const sum = freeRecords.reduce((total, record) => total + record.quantity, 0n);
          fc.pre(sum !== 0n);

          const sourceId = randomUUID();

          await expect(
            asRuntimeTenant(async (client) => {
              const { rows } = await client.query<{ id: string }>(
                `INSERT INTO ledger_transactions (tenant_id, source_type, source_id, effective_at, description)
                 VALUES ($1, 'SETTLEMENT', $2, now(), 'ناوردا — SQL مستقیم')
                 RETURNING id`,
                [tenantId, sourceId],
              );
              const transactionId = rows[0]!.id;

              for (const record of freeRecords) {
                await client.query(
                  `INSERT INTO ledger_entries (tenant_id, transaction_id, account_id, dimension_id, quantity)
                   VALUES ($1, $2, $3, $4, $5::bigint)`,
                  [
                    tenantId,
                    transactionId,
                    accountIds[record.accountIndex],
                    dimensionId,
                    record.quantity.toString(),
                  ],
                );
              }
            }),
          ).rejects.toThrow(/not balanced/u);

          const persisted = await pool.query('SELECT id FROM ledger_transactions WHERE source_id = $1', [
            sourceId,
          ]);
          expect(persisted.rows).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS, seed: SEED + 4 },
    );
  });
});
