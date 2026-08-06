import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import {
  APP_DATABASE_ROLE,
  TENANT_SETTING,
} from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import type { INestApplicationContext } from '@nestjs/common';
import type { PoolClient } from 'pg';

type PostingTargets = {
  readonly bankAccountId: string;
  readonly cashAccountId: string;
  readonly cogsJewelryAccountId: string;
  readonly goldDimensionId: string;
  readonly jewelryInventoryAccountId: string;
  readonly rialDimensionId: string;
};

type EntryInput = {
  readonly accountId: string;
  readonly dimensionId: string;
  readonly quantity: string;
};

/**
 * Constraint trigger ledger balance — BE-033.
 *
 * عمداً با pg خام و نقش واقعی runtime اجرا می‌شود. در اینجا هیچ serviceای برای
 * تراز گرفتن وجود ندارد؛ اگر migration یا trigger حذف شود، این آزمون باید شکست
 * بخورد حتی با وجود سالم بودن لایه‌ی Nest و Drizzle.
 */
describe('Constraint trigger تراز دفتر کل (BE-033)', () => {
  let app: INestApplicationContext;
  let tenantService: TenantService;
  const tenantIds: string[] = [];
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://gold:gold@localhost:5432/gold_test',
  });

  async function createTenant(label = 'تراز دفتر کل') {
    const tenant = await tenantService.create({
      name: label,
      slug: `ledger-balance-${randomUUID().slice(0, 12)}`,
    });
    tenantIds.push(tenant.id);
    return tenant;
  }

  async function asRuntimeTenant<T>(
    tenantId: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
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

  async function getPostingTargets(tenantId: string): Promise<PostingTargets> {
    const { rows: accountRows } = await pool.query<{ id: string; systemKey: string }>(
      `SELECT id, system_key AS "systemKey"
       FROM ledger_accounts
       WHERE tenant_id = $1
         AND system_key = ANY($2::text[])`,
      [
        tenantId,
        ['CASH', 'BANK', 'INVENTORY_JEWELRY', 'COGS_JEWELRY'],
      ],
    );
    const { rows: dimensionRows } = await pool.query<{ id: string; code: string }>(
      `SELECT id, code
       FROM asset_dimensions
       WHERE tenant_id = $1
         AND code = ANY($2::text[])`,
      [tenantId, ['RIAL', 'GOLD']],
    );
    const accounts = new Map(accountRows.map((account) => [account.systemKey, account.id]));
    const dimensions = new Map(dimensionRows.map((dimension) => [dimension.code, dimension.id]));

    const cashAccountId = accounts.get('CASH');
    const bankAccountId = accounts.get('BANK');
    const jewelryInventoryAccountId = accounts.get('INVENTORY_JEWELRY');
    const cogsJewelryAccountId = accounts.get('COGS_JEWELRY');
    const rialDimensionId = dimensions.get('RIAL');
    const goldDimensionId = dimensions.get('GOLD');
    if (
      !cashAccountId ||
      !bankAccountId ||
      !jewelryInventoryAccountId ||
      !cogsJewelryAccountId ||
      !rialDimensionId ||
      !goldDimensionId
    ) {
      throw new Error('حساب‌ها یا ابعاد لازم دفتر کل seed نشده‌اند.');
    }

    return {
      cashAccountId,
      bankAccountId,
      jewelryInventoryAccountId,
      cogsJewelryAccountId,
      rialDimensionId,
      goldDimensionId,
    };
  }

  async function insertTransaction(
    client: PoolClient,
    tenantId: string,
    sourceId: string,
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (
         tenant_id,
         source_type,
         source_id,
         effective_at,
         description
       )
       VALUES ($1, 'SETTLEMENT', $2, $3, $4)
       RETURNING id`,
      [tenantId, sourceId, '2026-08-06T00:00:00.000Z', 'آزمون مستقیم تراز دفتر کل'],
    );
    const [ledgerTransaction] = rows;
    if (!ledgerTransaction) {
      throw new Error('سربرگ دفتر کل ساخته نشد.');
    }

    return ledgerTransaction.id;
  }

  async function insertEntry(
    client: PoolClient,
    tenantId: string,
    transactionId: string,
    entry: EntryInput,
  ): Promise<void> {
    await client.query(
      `INSERT INTO ledger_entries (
         tenant_id,
         transaction_id,
         account_id,
         dimension_id,
         quantity
       )
       VALUES ($1, $2, $3, $4, $5::bigint)`,
      [tenantId, transactionId, entry.accountId, entry.dimensionId, entry.quantity],
    );
  }

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    tenantService = app.get(TenantService);
  });

  afterAll(async () => {
    for (const tenantId of tenantIds) {
      // این اتصال نقش migration دارد؛ نقش runtime و triggerهای append-only عمداً
      // برای پاک‌سازی tenantهای کوتاه‌عمر آزمون دور زده نمی‌شوند.
      await pool.query('DELETE FROM ledger_entries WHERE tenant_id = $1', [tenantId]);
      await pool.query('DELETE FROM ledger_transactions WHERE tenant_id = $1', [tenantId]);
      await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    }
    await app.close();
    await pool.end();
  });

  it('خود trigger یک constraint trigger با DEFERRABLE INITIALLY DEFERRED است', async () => {
    const { rows } = await pool.query<{
      tgconstraint: string;
      tgdeferrable: boolean;
      tginitdeferred: boolean;
    }>(
      `SELECT tgconstraint::text, tgdeferrable, tginitdeferred
       FROM pg_trigger
       WHERE tgname = 'ledger_entries_balance_per_dimension'`,
    );

    expect(rows).toEqual([
      expect.objectContaining({
        tgdeferrable: true,
        tginitdeferred: true,
      }),
    ]);
    expect(rows[0]?.tgconstraint).not.toBe('0');
  });

  it('entryهای متوازن پس از تکمیل همه‌ی ردیف‌ها commit می‌شوند', async () => {
    const tenant = await createTenant();
    const targets = await getPostingTargets(tenant.id);

    const transactionId = await asRuntimeTenant(tenant.id, async (client) => {
      const ledgerTransactionId = await insertTransaction(client, tenant.id, randomUUID());

      // این نقطه عمداً قبل از entry متقابل است. چون trigger deferred است، insert
      // اول خطا نمی‌دهد و تراز نهایی فقط در COMMIT سنجیده می‌شود.
      await insertEntry(client, tenant.id, ledgerTransactionId, {
        accountId: targets.cashAccountId,
        dimensionId: targets.rialDimensionId,
        quantity: '7',
      });
      await insertEntry(client, tenant.id, ledgerTransactionId, {
        accountId: targets.bankAccountId,
        dimensionId: targets.rialDimensionId,
        quantity: '-7',
      });

      return ledgerTransactionId;
    });

    const { rows } = await pool.query<{ quantity: string }>(
      'SELECT quantity::text FROM ledger_entries WHERE transaction_id = $1 ORDER BY quantity',
      [transactionId],
    );
    expect(rows.map((entry) => entry.quantity)).toEqual(['-7', '7']);
  });

  it('transaction نامتوازن حتی با SQL مستقیم در commit رد و rollback می‌شود', async () => {
    const tenant = await createTenant();
    const targets = await getPostingTargets(tenant.id);
    const sourceId = randomUUID();

    await expect(
      asRuntimeTenant(tenant.id, async (client) => {
        const transactionId = await insertTransaction(client, tenant.id, sourceId);
        await insertEntry(client, tenant.id, transactionId, {
          accountId: targets.cashAccountId,
          dimensionId: targets.rialDimensionId,
          quantity: '7',
        });
      }),
    ).rejects.toThrow(/not balanced/u);

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM ledger_transactions
       WHERE tenant_id = $1 AND source_id = $2`,
      [tenant.id, sourceId],
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('هر بُعد مستقل بررسی می‌شود؛ تراز ریال، کسری طلا را پنهان نمی‌کند', async () => {
    const tenant = await createTenant();
    const targets = await getPostingTargets(tenant.id);

    await asRuntimeTenant(tenant.id, async (client) => {
      const transactionId = await insertTransaction(client, tenant.id, randomUUID());
      const balancedEntries: readonly EntryInput[] = [
        {
          accountId: targets.cashAccountId,
          dimensionId: targets.rialDimensionId,
          quantity: '7',
        },
        {
          accountId: targets.bankAccountId,
          dimensionId: targets.rialDimensionId,
          quantity: '-7',
        },
        {
          accountId: targets.cogsJewelryAccountId,
          dimensionId: targets.goldDimensionId,
          quantity: '3',
        },
        {
          accountId: targets.jewelryInventoryAccountId,
          dimensionId: targets.goldDimensionId,
          quantity: '-3',
        },
      ];

      for (const entry of balancedEntries) {
        await insertEntry(client, tenant.id, transactionId, entry);
      }
    });

    await expect(
      asRuntimeTenant(tenant.id, async (client) => {
        const transactionId = await insertTransaction(client, tenant.id, randomUUID());
        const unbalancedEntries: readonly EntryInput[] = [
          {
            accountId: targets.cashAccountId,
            dimensionId: targets.rialDimensionId,
            quantity: '7',
          },
          {
            accountId: targets.bankAccountId,
            dimensionId: targets.rialDimensionId,
            quantity: '-7',
          },
          {
            accountId: targets.cogsJewelryAccountId,
            dimensionId: targets.goldDimensionId,
            quantity: '3',
          },
        ];

        for (const entry of unbalancedEntries) {
          await insertEntry(client, tenant.id, transactionId, entry);
        }
      }),
    ).rejects.toThrow(/not balanced/u);
  });
});
