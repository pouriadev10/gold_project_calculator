import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
  assetDimensions,
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
  readonly bankAccountId: string;
  readonly cashAccountId: string;
  readonly rialDimensionId: string;
};

type RawPosting = {
  readonly entryIds: readonly string[];
  readonly transactionId: string;
};

/** Ledger transaction and entry schema — BE-032. Requires a real PostgreSQL database. */
describe('تراکنش و entry دفتر کل (BE-032)', () => {
  let app: INestApplicationContext;
  let db: Database;
  let tenantService: TenantService;
  const tenantIds: string[] = [];

  async function createTenant(label = 'دفتر کل') {
    const tenant = await tenantService.create({
      name: label,
      slug: `ledger-transactions-${randomUUID().slice(0, 12)}`,
    });
    tenantIds.push(tenant.id);
    return tenant;
  }

  async function getPostingTargets(tenantId: string): Promise<PostingTargets> {
    return withTenantTransaction(db, tenantId, async (transaction) => {
      const [cashAccount] = await transaction
        .select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.tenantId, tenantId),
            eq(ledgerAccounts.systemKey, 'CASH'),
          ),
        )
        .limit(1);
      const [bankAccount] = await transaction
        .select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.tenantId, tenantId),
            eq(ledgerAccounts.systemKey, 'BANK'),
          ),
        )
        .limit(1);
      const [rialDimension] = await transaction
        .select({ id: assetDimensions.id })
        .from(assetDimensions)
        .where(
          and(
            eq(assetDimensions.tenantId, tenantId),
            eq(assetDimensions.code, 'RIAL'),
          ),
        )
        .limit(1);

      if (!cashAccount || !bankAccount || !rialDimension) {
        throw new Error('حساب‌ها یا بُعد پایه‌ی مستأجر seed نشده‌اند.');
      }

      return {
        cashAccountId: cashAccount.id,
        bankAccountId: bankAccount.id,
        rialDimensionId: rialDimension.id,
      };
    });
  }

  async function insertRawPosting(
    tenantId: string,
    targets: PostingTargets,
    sourceId = randomUUID(),
  ): Promise<RawPosting> {
    return withTenantTransaction(db, tenantId, async (transaction) => {
      const [ledgerTransaction] = await transaction
        .insert(ledgerTransactions)
        .values({
          tenantId,
          sourceType: 'OPENING_BALANCE',
          sourceId,
          effectiveAt: new Date('2026-08-06T00:00:00Z'),
          description: 'ثبت آزمایشی دفتر کل',
        })
        .returning({ id: ledgerTransactions.id });

      if (!ledgerTransaction) {
        throw new Error('سربرگ دفتر کل ساخته نشد.');
      }

      const entries = await transaction
        .insert(ledgerEntries)
        .values([
          {
            tenantId,
            transactionId: ledgerTransaction.id,
            accountId: targets.cashAccountId,
            dimensionId: targets.rialDimensionId,
            quantity: 7n,
            metadata: { sourceSnapshotId: sourceId, quantityRial: '7' },
          },
          {
            tenantId,
            transactionId: ledgerTransaction.id,
            accountId: targets.bankAccountId,
            dimensionId: targets.rialDimensionId,
            quantity: -7n,
            metadata: { sourceSnapshotId: sourceId, quantityRial: '-7' },
          },
        ])
        .returning({ id: ledgerEntries.id });

      return {
        transactionId: ledgerTransaction.id,
        entryIds: entries.map((entry) => entry.id),
      };
    });
  }

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = app.get<Database>(DRIZZLE);
    tenantService = app.get(TenantService);
  });

  afterAll(async () => {
    for (const tenantId of tenantIds) {
      // پاک‌سازی تست با نقش migration انجام می‌شود، نه نقش runtime؛ triggerهای
      // append-only فقط دسترسی برنامه را می‌بندند تا حذف آبشاری tenant توسعه‌ای ممکن بماند.
      await db.delete(ledgerEntries).where(eq(ledgerEntries.tenantId, tenantId));
      await db.delete(ledgerTransactions).where(eq(ledgerTransactions.tenantId, tenantId));
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await app.close();
  });

  it('منبع قابل ردیابی، quantity bigint علامت‌دار و یکتایی source هر tenant را نگه می‌دارد', async () => {
    const tenant = await createTenant();
    const targets = await getPostingTargets(tenant.id);
    const sourceId = randomUUID();
    const posting = await insertRawPosting(tenant.id, targets, sourceId);

    const saved = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      transactions: await transaction
        .select()
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.id, posting.transactionId)),
      entries: await transaction
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.transactionId, posting.transactionId)),
    }));

    expect(saved.transactions).toHaveLength(1);
    expect(saved.transactions[0]).toMatchObject({
      tenantId: tenant.id,
      sourceType: 'OPENING_BALANCE',
      sourceId,
      description: 'ثبت آزمایشی دفتر کل',
    });
    expect(new Set(saved.entries.map((entry) => entry.quantity))).toEqual(new Set([7n, -7n]));
    expect(saved.entries.map((entry) => entry.metadata)).toEqual(
      expect.arrayContaining([
        { sourceSnapshotId: sourceId, quantityRial: '7' },
        { sourceSnapshotId: sourceId, quantityRial: '-7' },
      ]),
    );

    await expect(insertRawPosting(tenant.id, targets, sourceId)).rejects.toThrow();
  });

  it('foreign key مرکب، account مستأجر دیگر را به transaction جاری وصل نمی‌کند', async () => {
    const tenantA = await createTenant('دفتر کل A');
    const tenantB = await createTenant('دفتر کل B');
    const targetsA = await getPostingTargets(tenantA.id);
    const targetsB = await getPostingTargets(tenantB.id);

    await expect(
      withTenantTransaction(db, tenantA.id, async (transaction) => {
        const [ledgerTransaction] = await transaction
          .insert(ledgerTransactions)
          .values({
            tenantId: tenantA.id,
            sourceType: 'SETTLEMENT',
            sourceId: randomUUID(),
            effectiveAt: new Date('2026-08-06T00:00:00Z'),
            description: 'آزمون جداسازی حساب دفتر کل',
          })
          .returning({ id: ledgerTransactions.id });

        if (!ledgerTransaction) {
          throw new Error('سربرگ دفتر کل ساخته نشد.');
        }

        return transaction.insert(ledgerEntries).values({
          tenantId: tenantA.id,
          transactionId: ledgerTransaction.id,
          accountId: targetsB.cashAccountId,
          dimensionId: targetsA.rialDimensionId,
          quantity: 7n,
        });
      }),
    ).rejects.toThrow();
  });

  it('entry سکه را فقط به‌صورت count bigint در بُعد مستقل همان سکه نگه می‌دارد', async () => {
    const tenant = await createTenant();

    const saved = await withTenantTransaction(db, tenant.id, async (transaction) => {
      const [coinDimension] = await transaction
        .select({ id: assetDimensions.id, coinTypeId: assetDimensions.coinTypeId })
        .from(assetDimensions)
        .where(
          and(
            eq(assetDimensions.tenantId, tenant.id),
            eq(assetDimensions.kind, 'COIN'),
          ),
        )
        .limit(1);
      const [cogsAccount] = await transaction
        .select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.tenantId, tenant.id),
            eq(ledgerAccounts.systemKey, 'COGS_COIN'),
          ),
        )
        .limit(1);

      if (!coinDimension?.coinTypeId || !cogsAccount) {
        throw new Error('بُعد یا حساب سکه‌ی مستأجر seed نشده‌اند.');
      }

      const [coinInventoryAccount] = await transaction
        .select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.tenantId, tenant.id),
            eq(ledgerAccounts.systemKey, `INVENTORY_COIN:${coinDimension.coinTypeId}`),
          ),
        )
        .limit(1);
      if (!coinInventoryAccount) {
        throw new Error('حساب موجودی همان نوع سکه seed نشده است.');
      }

      const [ledgerTransaction] = await transaction
        .insert(ledgerTransactions)
        .values({
          tenantId: tenant.id,
          sourceType: 'SALES_INVOICE',
          sourceId: randomUUID(),
          effectiveAt: new Date('2026-08-06T00:00:00Z'),
          description: 'ثبت آزمایشی count سکه',
        })
        .returning({ id: ledgerTransactions.id });
      if (!ledgerTransaction) {
        throw new Error('سربرگ فروش سکه ساخته نشد.');
      }

      return transaction
        .insert(ledgerEntries)
        .values([
          {
            tenantId: tenant.id,
            transactionId: ledgerTransaction.id,
            accountId: cogsAccount.id,
            dimensionId: coinDimension.id,
            quantity: 3n,
          },
          {
            tenantId: tenant.id,
            transactionId: ledgerTransaction.id,
            accountId: coinInventoryAccount.id,
            dimensionId: coinDimension.id,
            quantity: -3n,
          },
        ])
        .returning({ dimensionId: ledgerEntries.dimensionId, quantity: ledgerEntries.quantity });
    });

    const [firstEntry] = saved;
    if (!firstEntry) {
      throw new Error('entry سکه ساخته نشد.');
    }

    expect(saved.map((entry) => entry.dimensionId)).toEqual([
      firstEntry.dimensionId,
      firstEntry.dimensionId,
    ]);
    expect(new Set(saved.map((entry) => entry.quantity))).toEqual(new Set([3n, -3n]));
  });

  it('role runtime نمی‌تواند entry یا سربرگ دفتر کل را update/delete کند', async () => {
    const tenant = await createTenant();
    const targets = await getPostingTargets(tenant.id);
    const posting = await insertRawPosting(tenant.id, targets);
    const [entryId] = posting.entryIds;
    if (!entryId) {
      throw new Error('entry دفتر کل ساخته نشد.');
    }

    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        transaction
          .update(ledgerEntries)
          .set({ quantity: 8n })
          .where(eq(ledgerEntries.id, entryId)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        transaction.delete(ledgerEntries).where(eq(ledgerEntries.id, entryId)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        transaction
          .update(ledgerTransactions)
          .set({ description: 'بازنویسی ممنوع' })
          .where(eq(ledgerTransactions.id, posting.transactionId)),
      ),
    ).rejects.toThrow();

    const existingEntries = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.transactionId, posting.transactionId)),
    );
    expect(existingEntries).toHaveLength(2);
  });
});
