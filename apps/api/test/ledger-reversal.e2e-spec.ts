import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
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
import { LedgerTransactionNotFoundError } from '../src/modules/ledger/ledger-reversal.errors';
import { LedgerReversalService } from '../src/modules/ledger/ledger-reversal.service';
import { LedgerPostingService } from '../src/modules/ledger/ledger-posting.service';
import { TenantService } from '../src/platform/tenant/tenant.service';
import type { INestApplicationContext } from '@nestjs/common';
import type { Database } from '../src/platform/database/connect';
import type { LedgerPostingInput } from '../src/modules/ledger/ledger-posting.service';

type PostingTargets = {
  readonly bankAccountId: string;
  readonly cashAccountId: string;
  readonly cogsJewelryAccountId: string;
  readonly goldDimensionId: string;
  readonly jewelryInventoryAccountId: string;
  readonly rialDimensionId: string;
};

/** Ledger reversal — BE-036. Runs against a real PostgreSQL database. */
describe('Reversal دفتر کل (BE-036)', () => {
  let app: INestApplicationContext;
  let db: Database;
  let postingService: LedgerPostingService;
  let reversalService: LedgerReversalService;
  let tenantService: TenantService;
  const tenantIds: string[] = [];

  async function createTenant(label = 'reversal') {
    const tenant = await tenantService.create({
      name: label,
      slug: `ledger-reversal-${randomUUID().slice(0, 12)}`,
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
      const bankAccountId = accountsByKey.get('BANK');
      const cogsJewelryAccountId = accountsByKey.get('COGS_JEWELRY');
      const jewelryInventoryAccountId = accountsByKey.get('INVENTORY_JEWELRY');
      const rialDimensionId = dimensionsByCode.get('RIAL');
      const goldDimensionId = dimensionsByCode.get('GOLD');

      if (
        !cashAccountId ||
        !bankAccountId ||
        !cogsJewelryAccountId ||
        !jewelryInventoryAccountId ||
        !rialDimensionId ||
        !goldDimensionId
      ) {
        throw new Error('حساب‌ها یا ابعاد لازم برای آزمون reversal seed نشده‌اند.');
      }

      return {
        cashAccountId,
        bankAccountId,
        cogsJewelryAccountId,
        jewelryInventoryAccountId,
        rialDimensionId,
        goldDimensionId,
      };
    });
  }

  function samplePosting(
    tenantId: string,
    targets: PostingTargets,
    sourceId = randomUUID(),
  ): LedgerPostingInput {
    return {
      source: { tenantId, type: 'SETTLEMENT', id: sourceId },
      effectiveAt: new Date('2026-08-07T00:00:00.000Z'),
      description: 'فروش آزمایشی برای اصلاح بعدی',
      entries: [
        { accountId: targets.cashAccountId, dimensionId: targets.rialDimensionId, quantity: 90_000n },
        { accountId: targets.bankAccountId, dimensionId: targets.rialDimensionId, quantity: -90_000n },
        {
          accountId: targets.cogsJewelryAccountId,
          dimensionId: targets.goldDimensionId,
          quantity: 4_500n,
        },
        {
          accountId: targets.jewelryInventoryAccountId,
          dimensionId: targets.goldDimensionId,
          quantity: -4_500n,
        },
      ],
    };
  }

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = app.get<Database>(DRIZZLE);
    postingService = app.get(LedgerPostingService);
    reversalService = app.get(LedgerReversalService);
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

  it('اثر تراکنش اصلی را خنثی می‌کند و خودِ رکورد اصلی دست‌نخورده می‌ماند', async () => {
    const tenant = await createTenant();
    const targets = await getPostingTargets(tenant.id);
    const original = await postingService.post(samplePosting(tenant.id, targets));

    const result = await reversalService.reverse({
      tenantId: tenant.id,
      transactionId: original.transaction.id,
      effectiveAt: new Date('2026-08-07T01:00:00.000Z'),
      description: 'اصلاح: وزن اشتباه ثبت شده بود',
    });

    expect(result.alreadyReversed).toBe(false);
    expect(result.reversalTransaction.reversalOfTransactionId).toBe(original.transaction.id);
    expect(result.entries.map((entry) => entry.quantity).sort()).toEqual(
      original.entries.map((entry) => -entry.quantity).sort(),
    );

    // رکورد اصلی — هم سربرگ، هم entryها — عیناً همان‌طور که بود می‌ماند.
    const originalAfter = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      header: await transaction
        .select()
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.id, original.transaction.id)),
      entries: await transaction
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.transactionId, original.transaction.id))
        .orderBy(ledgerEntries.id),
    }));
    expect(originalAfter.header).toEqual([original.transaction]);
    expect(originalAfter.entries.map((entry) => entry.quantity).sort()).toEqual(
      original.entries.map((entry) => entry.quantity).sort(),
    );

    // اثر خالص روی هر (حساب، بُعد) پس از رفت + برگشت دقیقاً صفر است.
    const combined = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select({
          accountId: ledgerEntries.accountId,
          dimensionId: ledgerEntries.dimensionId,
          quantity: ledgerEntries.quantity,
        })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.tenantId, tenant.id)),
    );
    const net = new Map<string, bigint>();
    for (const row of combined) {
      const key = `${row.accountId}:${row.dimensionId}`;
      net.set(key, (net.get(key) ?? 0n) + row.quantity);
    }
    expect([...net.values()].every((total) => total === 0n)).toBe(true);
  });

  it('audit log مخصوص reversal ثبت می‌شود', async () => {
    const tenant = await createTenant();
    const targets = await getPostingTargets(tenant.id);
    const original = await postingService.post(samplePosting(tenant.id, targets));

    const result = await reversalService.reverse({
      tenantId: tenant.id,
      transactionId: original.transaction.id,
      effectiveAt: new Date(),
      description: 'اصلاح آزمایشی',
      createdBy: null,
    });

    const audit = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenant.id),
            eq(auditLogs.action, 'LEDGER_REVERSED'),
            eq(auditLogs.entityId, result.reversalTransaction.id),
          ),
        ),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.afterData).toEqual({ reversalOfTransactionId: original.transaction.id });
  });

  it('reverse دوباره‌ی همان تراکنش، همان reversal قبلی را برمی‌گرداند نه یک سند تازه', async () => {
    const tenant = await createTenant();
    const targets = await getPostingTargets(tenant.id);
    const original = await postingService.post(samplePosting(tenant.id, targets));

    const first = await reversalService.reverse({
      tenantId: tenant.id,
      transactionId: original.transaction.id,
      effectiveAt: new Date(),
      description: 'اصلاح اول',
    });
    const second = await reversalService.reverse({
      tenantId: tenant.id,
      transactionId: original.transaction.id,
      effectiveAt: new Date(),
      description: 'تلاش دومِ اصلاح — باید idempotent باشد',
    });

    expect(first.alreadyReversed).toBe(false);
    expect(second.alreadyReversed).toBe(true);
    expect(second.reversalTransaction.id).toBe(first.reversalTransaction.id);

    const allReversals = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select({ id: ledgerTransactions.id })
        .from(ledgerTransactions)
        .where(
          and(
            eq(ledgerTransactions.tenantId, tenant.id),
            eq(ledgerTransactions.reversalOfTransactionId, original.transaction.id),
          ),
        ),
    );
    expect(allReversals).toHaveLength(1);
  });

  it('دو تلاش هم‌زمان برای reverse کردن یک تراکنش، دقیقاً یک reversal می‌سازند', async () => {
    const tenant = await createTenant();
    const targets = await getPostingTargets(tenant.id);
    const original = await postingService.post(samplePosting(tenant.id, targets));

    const input = {
      tenantId: tenant.id,
      transactionId: original.transaction.id,
      effectiveAt: new Date(),
      description: 'اصلاح هم‌زمان',
    };
    const [first, second] = await Promise.all([
      reversalService.reverse(input),
      reversalService.reverse(input),
    ]);

    expect(first.reversalTransaction.id).toBe(second.reversalTransaction.id);
    expect([first.alreadyReversed, second.alreadyReversed].sort()).toEqual([false, true]);

    const allReversals = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select({ id: ledgerTransactions.id })
        .from(ledgerTransactions)
        .where(
          and(
            eq(ledgerTransactions.tenantId, tenant.id),
            eq(ledgerTransactions.reversalOfTransactionId, original.transaction.id),
          ),
        ),
    );
    expect(allReversals).toHaveLength(1);
  });

  it('یک reversal را هم می‌شود reverse کرد — بازگشت کامل به وضعیت اصلی', async () => {
    const tenant = await createTenant();
    const targets = await getPostingTargets(tenant.id);
    const original = await postingService.post(samplePosting(tenant.id, targets));
    const firstReversal = await reversalService.reverse({
      tenantId: tenant.id,
      transactionId: original.transaction.id,
      effectiveAt: new Date(),
      description: 'اصلاح اول',
    });

    const reversalOfReversal = await reversalService.reverse({
      tenantId: tenant.id,
      transactionId: firstReversal.reversalTransaction.id,
      effectiveAt: new Date(),
      description: 'اصلاحِ اصلاح — در واقع اعمال دوباره‌ی سند اصلی',
    });

    expect(reversalOfReversal.alreadyReversed).toBe(false);
    expect(reversalOfReversal.entries.map((entry) => entry.quantity).sort()).toEqual(
      original.entries.map((entry) => entry.quantity).sort(),
    );
  });

  it('reverse کردن تراکنشی که وجود ندارد خطای دامنه می‌دهد', async () => {
    const tenant = await createTenant();

    await expect(
      reversalService.reverse({
        tenantId: tenant.id,
        transactionId: randomUUID(),
        effectiveAt: new Date(),
        description: 'وجود ندارد',
      }),
    ).rejects.toBeInstanceOf(LedgerTransactionNotFoundError);
  });

  it('تراکنشِ مستأجر دیگر قابل reverse کردن نیست', async () => {
    const tenantA = await createTenant('reversal A');
    const tenantB = await createTenant('reversal B');
    const targetsA = await getPostingTargets(tenantA.id);
    const original = await postingService.post(samplePosting(tenantA.id, targetsA));

    await expect(
      reversalService.reverse({
        tenantId: tenantB.id,
        transactionId: original.transaction.id,
        effectiveAt: new Date(),
        description: 'تلاش از مستأجر اشتباه',
      }),
    ).rejects.toBeInstanceOf(LedgerTransactionNotFoundError);
  });

  it('سرویس هیچ متد به‌روزرسانی یا حذفی ندارد', () => {
    const methods = Object.getOwnPropertyNames(LedgerReversalService.prototype);

    expect(methods.some((name) => /^(update|delete|remove)/u.test(name))).toBe(false);
  });
});
