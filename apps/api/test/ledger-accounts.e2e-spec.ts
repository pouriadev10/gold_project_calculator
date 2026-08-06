import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import {
  LedgerAccountPartyNotFoundError,
} from '../src/modules/ledger/ledger-accounts.errors';
import { LedgerAccountsService } from '../src/modules/ledger/ledger-accounts.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
  coinTypes,
  ledgerAccounts,
  parties,
  tenants,
} from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import type { INestApplicationContext } from '@nestjs/common';
import type { Database } from '../src/platform/database/connect';

const BASE_SYSTEM_KEYS = [
  'CASH',
  'BANK',
  'INVENTORY_JEWELRY',
  'INVENTORY_MELTED_GOLD',
  'ACCOUNTS_RECEIVABLE_CONTROL',
  'ACCOUNTS_PAYABLE_CONTROL',
  'SALES_REVENUE',
  'WAGE_REVENUE',
  'COGS_JEWELRY',
  'COGS_COIN',
  'PURCHASE_FROM_CONSUMER',
  'TAX_PAYABLE',
  'OPENING_EQUITY',
  'PROFIT_LOSS',
  'SETTLEMENT_CONVERSION_CLEARING',
] as const;

/** Chart of accounts — BE-031. نیازمند PostgreSQL واقعی. */
describe('حساب‌های دفتر کل (BE-031)', () => {
  let app: INestApplicationContext;
  let db: Database;
  let tenantService: TenantService;
  let accountsService: LedgerAccountsService;
  const tenantIds: string[] = [];

  async function createTenant(label = 'حساب‌ها') {
    const tenant = await tenantService.create({
      name: label,
      slug: `ledger-accounts-${randomUUID().slice(0, 12)}`,
    });
    tenantIds.push(tenant.id);
    return tenant;
  }

  async function createParty(tenantId: string) {
    return withTenantTransaction(db, tenantId, async (transaction) => {
      const [party] = await transaction
        .insert(parties)
        .values({
          tenantId,
          type: 'CONSUMER',
          displayName: 'مشتری حساب‌دار',
          normalizedName: 'مشتری حساب دار',
          status: 'ACTIVE',
        })
        .returning();

      return party!;
    });
  }

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = app.get<Database>(DRIZZLE);
    tenantService = app.get(TenantService);
    accountsService = app.get(LedgerAccountsService);
  });

  afterAll(async () => {
    for (const tenantId of tenantIds) {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await app.close();
  });

  it('chart پایه و حساب جداگانه‌ی count-only هر نوع سکه را در ساخت tenant seed می‌کند', async () => {
    const tenant = await createTenant();
    const seeded = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      accounts: await transaction
        .select()
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.tenantId, tenant.id)),
      coinTypes: await transaction.select().from(coinTypes).where(eq(coinTypes.tenantId, tenant.id)),
    }));

    const base = seeded.accounts.filter(
      (account) => account.systemKey !== null && !account.systemKey.startsWith('INVENTORY_COIN:'),
    );
    expect(base.map((account) => account.systemKey).sort()).toEqual([...BASE_SYSTEM_KEYS].sort());

    const coinAccounts = seeded.accounts.filter((account) =>
      account.systemKey?.startsWith('INVENTORY_COIN:'),
    );
    expect(coinAccounts).toHaveLength(seeded.coinTypes.length);
    expect(
      new Set(coinAccounts.map((account) => account.systemKey?.replace('INVENTORY_COIN:', ''))),
    ).toEqual(new Set(seeded.coinTypes.map((coinType) => coinType.id)));
    expect(coinAccounts.every((account) => account.accountType === 'ASSET' && account.active)).toBe(
      true,
    );
  });

  it('دیتابیس system key تکراری در یک tenant را رد می‌کند', async () => {
    const tenant = await createTenant();

    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        transaction.insert(ledgerAccounts).values({
          tenantId: tenant.id,
          code: 'ASSET:DUPLICATE_CASH',
          title: 'صندوق تکراری',
          accountType: 'ASSET',
          systemKey: 'CASH',
          active: true,
        }),
      ),
    ).rejects.toThrow();
  });

  it('برای Party همان tenant دو subledger دریافتنی/پرداختنی idempotent می‌سازد', async () => {
    const tenant = await createTenant();
    const party = await createParty(tenant.id);

    const first = await accountsService.ensurePartyAccounts({
      tenantId: tenant.id,
      partyId: party.id,
    });
    const retried = await accountsService.ensurePartyAccounts({
      tenantId: tenant.id,
      partyId: party.id,
    });

    expect(first.receivable).toMatchObject({
      tenantId: tenant.id,
      partyId: party.id,
      accountType: 'ASSET',
      systemKey: null,
      active: true,
    });
    expect(first.payable).toMatchObject({
      tenantId: tenant.id,
      partyId: party.id,
      accountType: 'LIABILITY',
      systemKey: null,
      active: true,
    });
    expect(retried.receivable.id).toBe(first.receivable.id);
    expect(retried.payable.id).toBe(first.payable.id);
  });

  it('Party مستأجر دیگر را به subledger tenant جاری وصل نمی‌کند', async () => {
    const tenantA = await createTenant('حساب‌های A');
    const tenantB = await createTenant('حساب‌های B');
    const partyB = await createParty(tenantB.id);

    await expect(
      accountsService.ensurePartyAccounts({ tenantId: tenantA.id, partyId: partyB.id }),
    ).rejects.toBeInstanceOf(LedgerAccountPartyNotFoundError);

    const crossTenantAccounts = await withTenantTransaction(db, tenantA.id, (transaction) =>
      transaction
        .select()
        .from(ledgerAccounts)
        .where(
          and(eq(ledgerAccounts.tenantId, tenantA.id), eq(ledgerAccounts.partyId, partyB.id)),
        ),
    );
    expect(crossTenantAccounts).toEqual([]);
  });

  it('service مسیر حذف حساب ندارد؛ entryهای BE-032 نیز با FK حذف حساب استفاده‌شده را می‌بندند', () => {
    const methods = Object.getOwnPropertyNames(LedgerAccountsService.prototype);

    expect(methods.some((name) => /^(delete|remove)/u.test(name))).toBe(false);
  });
});
