import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { LedgerAccountNotFoundError } from '../src/modules/ledger/account-balance.errors';
import { AccountBalanceService } from '../src/modules/ledger/account-balance.service';
import { LedgerPostingService } from '../src/modules/ledger/ledger-posting.service';
import { LedgerReversalService } from '../src/modules/ledger/ledger-reversal.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
  assetDimensions,
  coinTypes,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
  tenants,
} from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import type { INestApplicationContext } from '@nestjs/common';
import type { Database } from '../src/platform/database/connect';

type Targets = {
  readonly cashAccountId: string;
  readonly cogsJewelryAccountId: string;
  readonly cogsCoinAccountId: string;
  readonly jewelryInventoryAccountId: string;
  readonly rialDimensionId: string;
  readonly goldDimensionId: string;
  readonly coinDimensionByCode: Map<string, string>;
};

/** Query مانده حساب — BE-037. Runs against a real PostgreSQL database. */
describe('مانده‌ی حساب — getAccountBalances (BE-037)', () => {
  let app: INestApplicationContext;
  let db: Database;
  let postingService: LedgerPostingService;
  let reversalService: LedgerReversalService;
  let balanceService: AccountBalanceService;
  let tenantService: TenantService;
  const tenantIds: string[] = [];

  async function createTenant(label = 'account balance') {
    const tenant = await tenantService.create({
      name: label,
      slug: `account-balance-${randomUUID().slice(0, 12)}`,
    });
    tenantIds.push(tenant.id);
    return tenant;
  }

  async function getTargets(tenantId: string): Promise<Targets> {
    return withTenantTransaction(db, tenantId, async (transaction) => {
      const accounts = await transaction
        .select({ id: ledgerAccounts.id, systemKey: ledgerAccounts.systemKey })
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.tenantId, tenantId));
      const dimensions = await transaction
        .select({
          id: assetDimensions.id,
          code: assetDimensions.code,
          coinTypeId: assetDimensions.coinTypeId,
        })
        .from(assetDimensions)
        .where(eq(assetDimensions.tenantId, tenantId));
      const coinTypeRows = await transaction
        .select({ id: coinTypes.id, code: coinTypes.code })
        .from(coinTypes)
        .where(eq(coinTypes.tenantId, tenantId))
        .orderBy(asc(coinTypes.code));

      const accountsByKey = new Map(
        accounts.flatMap((account) =>
          account.systemKey === null ? [] : [[account.systemKey, account.id] as const],
        ),
      );
      const dimensionByCoinTypeId = new Map(
        dimensions.flatMap((dimension) =>
          dimension.coinTypeId === null ? [] : [[dimension.coinTypeId, dimension.id] as const],
        ),
      );
      const coinDimensionByCode = new Map(
        coinTypeRows.flatMap((coinType) => {
          const dimensionId = dimensionByCoinTypeId.get(coinType.id);
          return dimensionId === undefined ? [] : [[coinType.code, dimensionId] as const];
        }),
      );
      const rialDimensionId = dimensions.find((dimension) => dimension.code === 'RIAL')?.id;
      const goldDimensionId = dimensions.find((dimension) => dimension.code === 'GOLD')?.id;
      const cashAccountId = accountsByKey.get('CASH');
      const cogsJewelryAccountId = accountsByKey.get('COGS_JEWELRY');
      const cogsCoinAccountId = accountsByKey.get('COGS_COIN');
      const jewelryInventoryAccountId = accountsByKey.get('INVENTORY_JEWELRY');

      if (
        !rialDimensionId ||
        !goldDimensionId ||
        !cashAccountId ||
        !cogsJewelryAccountId ||
        !cogsCoinAccountId ||
        !jewelryInventoryAccountId ||
        coinDimensionByCode.size < 2
      ) {
        throw new Error('حساب‌ها یا ابعاد لازم برای آزمون مانده seed نشده‌اند.');
      }

      return {
        cashAccountId,
        cogsJewelryAccountId,
        cogsCoinAccountId,
        jewelryInventoryAccountId,
        rialDimensionId,
        goldDimensionId,
        coinDimensionByCode,
      };
    });
  }

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = app.get<Database>(DRIZZLE);
    postingService = app.get(LedgerPostingService);
    reversalService = app.get(LedgerReversalService);
    balanceService = app.get(AccountBalanceService);
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

  it('چند بُعد (ریال، طلا، دو نوع سکه‌ی مستقل) را جدا از هم جمع می‌زند', async () => {
    const tenant = await createTenant();
    const targets = await getTargets(tenant.id);
    const [codeA, dimensionIdA] = [...targets.coinDimensionByCode.entries()][0]!;
    const [codeB, dimensionIdB] = [...targets.coinDimensionByCode.entries()][1]!;

    await postingService.post({
      source: { tenantId: tenant.id, type: 'SETTLEMENT', id: randomUUID() },
      effectiveAt: new Date('2026-08-07T00:00:00.000Z'),
      description: 'ترکیبی — ریال، طلا، دو نوع سکه',
      entries: [
        { accountId: targets.cashAccountId, dimensionId: targets.rialDimensionId, quantity: 12_000_000n },
        {
          accountId: targets.cogsJewelryAccountId,
          dimensionId: targets.rialDimensionId,
          quantity: -12_000_000n,
        },
        {
          accountId: targets.cashAccountId,
          dimensionId: targets.goldDimensionId,
          quantity: -3_500_000n,
        },
        {
          accountId: targets.jewelryInventoryAccountId,
          dimensionId: targets.goldDimensionId,
          quantity: 3_500_000n,
        },
        { accountId: targets.cashAccountId, dimensionId: dimensionIdA, quantity: 2n },
        { accountId: targets.cogsCoinAccountId, dimensionId: dimensionIdA, quantity: -2n },
        { accountId: targets.cashAccountId, dimensionId: dimensionIdB, quantity: -1n },
        { accountId: targets.cogsCoinAccountId, dimensionId: dimensionIdB, quantity: 1n },
      ],
    });

    const balances = await balanceService.getAccountBalances(tenant.id, targets.cashAccountId);

    expect(balances.rial).toBe('12000000');
    expect(balances.gold).toBe('-3500000');
    expect(balances.silver).toBeUndefined();
    expect(balances.coins).toEqual({ [codeA]: 2, [codeB]: -1 });
  });

  it('حسابی که هرگز entry نداشته، خروجی خالی می‌گیرد نه صفرهای پیش‌فرض', async () => {
    const tenant = await createTenant();
    const targets = await getTargets(tenant.id);

    const balances = await balanceService.getAccountBalances(tenant.id, targets.cogsCoinAccountId);

    expect(balances).toEqual({ coins: {} });
  });

  it('مانده‌ی تاریخی با effective_at محاسبه می‌شود، نه created_at', async () => {
    const tenant = await createTenant();
    const targets = await getTargets(tenant.id);

    await postingService.post({
      source: { tenantId: tenant.id, type: 'SETTLEMENT', id: randomUUID() },
      effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
      description: 'رویداد اول',
      entries: [
        { accountId: targets.cashAccountId, dimensionId: targets.rialDimensionId, quantity: 1_000_000n },
        {
          accountId: targets.cogsJewelryAccountId,
          dimensionId: targets.rialDimensionId,
          quantity: -1_000_000n,
        },
      ],
    });
    await postingService.post({
      source: { tenantId: tenant.id, type: 'SETTLEMENT', id: randomUUID() },
      effectiveAt: new Date('2026-06-01T00:00:00.000Z'),
      description: 'رویداد دوم — بعد از تاریخ query',
      entries: [
        { accountId: targets.cashAccountId, dimensionId: targets.rialDimensionId, quantity: 2_000_000n },
        {
          accountId: targets.cogsJewelryAccountId,
          dimensionId: targets.rialDimensionId,
          quantity: -2_000_000n,
        },
      ],
    });

    const beforeSecond = await balanceService.getAccountBalances(
      tenant.id,
      targets.cashAccountId,
      new Date('2026-03-01T00:00:00.000Z'),
    );
    const exactlyOnFirst = await balanceService.getAccountBalances(
      tenant.id,
      targets.cashAccountId,
      new Date('2026-01-01T00:00:00.000Z'),
    );
    const current = await balanceService.getAccountBalances(tenant.id, targets.cashAccountId);

    expect(beforeSecond.rial).toBe('1000000');
    expect(exactlyOnFirst.rial).toBe('1000000');
    expect(current.rial).toBe('3000000');
  });

  it('پس از reverse شدنِ یک سند، مانده به همان قبل برمی‌گردد', async () => {
    const tenant = await createTenant();
    const targets = await getTargets(tenant.id);
    const original = await postingService.post({
      source: { tenantId: tenant.id, type: 'SETTLEMENT', id: randomUUID() },
      effectiveAt: new Date(),
      description: 'باید کاملاً reverse شود',
      entries: [
        { accountId: targets.cashAccountId, dimensionId: targets.rialDimensionId, quantity: 555n },
        {
          accountId: targets.cogsJewelryAccountId,
          dimensionId: targets.rialDimensionId,
          quantity: -555n,
        },
      ],
    });

    const beforeReversal = await balanceService.getAccountBalances(tenant.id, targets.cashAccountId);
    expect(beforeReversal.rial).toBe('555');

    await reversalService.reverse({
      tenantId: tenant.id,
      transactionId: original.transaction.id,
      effectiveAt: new Date(),
      description: 'اصلاح کامل',
    });

    // دو entry واقعی (رفت + برگشت) در بُعد ریال ثبت شده‌اند که جمعشان صفر
    // است — یعنی «rial: "0"» درست است، نه «undefined»: نبودِ کلید یعنی این
    // حساب هرگز در آن بُعد entry نداشته، نه اینکه مانده‌اش صفر شده.
    const afterReversal = await balanceService.getAccountBalances(tenant.id, targets.cashAccountId);
    expect(afterReversal.rial).toBe('0');
  });

  it('حساب مستأجر دیگر با خطای دامنه رد می‌شود', async () => {
    const tenantA = await createTenant('balance A');
    const tenantB = await createTenant('balance B');
    const targetsA = await getTargets(tenantA.id);

    await expect(
      balanceService.getAccountBalances(tenantB.id, targetsA.cashAccountId),
    ).rejects.toBeInstanceOf(LedgerAccountNotFoundError);
  });
});
