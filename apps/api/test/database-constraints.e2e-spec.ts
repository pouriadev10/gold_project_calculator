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

type TenantFixture = {
  readonly id: string;
  readonly cashAccountId: string;
  readonly bankAccountId: string;
  readonly rialDimensionId: string;
  readonly goldDimensionId: string;
  readonly coinTypeId: string;
  readonly coinDimensionId: string;
  readonly otherCoinTypeId: string;
  readonly otherCoinDimensionId: string;
};

/** ردیف‌های append-only که آزمون UPDATE/DELETE روی آن‌ها اجرا می‌شود. */
type AppendOnlyRows = Readonly<Record<string, string>>;

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-02-01T00:00:00.000Z';
const T2 = '2026-03-01T00:00:00.000Z';
const FAR_PAST_FROM = '2001-01-01T00:00:00.000Z';
const FAR_PAST_TO = '2001-01-02T00:00:00.000Z';

/**
 * محدودیت‌های دیتابیس — BE-063.
 *
 * معیار تسک: «داده‌ی نامعتبر حتی با SQL مستقیم رد شود». پس هیچ service یا
 * DTO ای اینجا نیست؛ همه‌چیز با `pg` خام و با **نقش مهاجرت** (superuser)
 * فرستاده می‌شود — قوی‌ترین حالت، چون RLS و نقش runtime را دور می‌زند. اگر
 * یکی از constraintها یا تریگرهای مهاجرت حذف شود، آزمون متناظرش باید بشکند.
 */
describe('محدودیت‌های دیتابیس با SQL مستقیم (BE-063)', () => {
  let app: INestApplicationContext;
  let tenantService: TenantService;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://gold:gold@localhost:5432/gold_test',
  });

  let a: TenantFixture;
  let b: TenantFixture;
  let partyId = '';
  let quoteId = '';
  let jewelryItemId = '';
  let otherTenantJewelryItemId = '';
  let otherTenantPartyId = '';
  let appendOnly: AppendOnlyRows = {};

  async function rows<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
    const result = await pool.query(text, [...params]);
    return result.rows as T[];
  }

  async function one<T>(text: string, params: readonly unknown[] = []): Promise<T> {
    const [row] = await rows<T>(text, params);
    if (row === undefined) {
      throw new Error(`پرس‌وجو ردیفی برنگرداند: ${text}`);
    }
    return row;
  }

  async function insertId(text: string, params: readonly unknown[] = []): Promise<string> {
    return (await one<{ id: string }>(text, params)).id;
  }

  async function inTransaction(work: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await work(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  function rejected(code: string, constraint?: string): Record<string, string> {
    return constraint === undefined ? { code } : { code, constraint };
  }

  async function createTenantFixture(label: string): Promise<TenantFixture> {
    const tenant = await tenantService.create({
      name: label,
      slug: `db-constraints-${randomUUID().slice(0, 12)}`,
    });
    tenantIds.push(tenant.id);

    const accounts = new Map(
      (
        await rows<{ id: string; systemKey: string }>(
          `SELECT id, system_key AS "systemKey" FROM ledger_accounts
           WHERE tenant_id = $1 AND system_key = ANY($2::text[])`,
          [tenant.id, ['CASH', 'BANK']],
        )
      ).map((row) => [row.systemKey, row.id]),
    );
    const dimensions = new Map(
      (
        await rows<{ id: string; code: string }>(
          `SELECT id, code FROM asset_dimensions WHERE tenant_id = $1 AND code = ANY($2::text[])`,
          [tenant.id, ['RIAL', 'GOLD']],
        )
      ).map((row) => [row.code, row.id]),
    );
    const coins = await rows<{ coinTypeId: string; dimensionId: string }>(
      `SELECT ct.id AS "coinTypeId", d.id AS "dimensionId"
       FROM coin_types ct
       JOIN asset_dimensions d ON d.tenant_id = ct.tenant_id AND d.coin_type_id = ct.id
       WHERE ct.tenant_id = $1
       ORDER BY ct.code
       LIMIT 2`,
      [tenant.id],
    );

    const cashAccountId = accounts.get('CASH');
    const bankAccountId = accounts.get('BANK');
    const rialDimensionId = dimensions.get('RIAL');
    const goldDimensionId = dimensions.get('GOLD');
    const [coin, otherCoin] = coins;
    if (
      cashAccountId === undefined ||
      bankAccountId === undefined ||
      rialDimensionId === undefined ||
      goldDimensionId === undefined ||
      coin === undefined ||
      otherCoin === undefined
    ) {
      throw new Error('حساب‌ها، ابعاد یا انواع سکه‌ی seed شده‌ی مستأجر کامل نیستند.');
    }

    return {
      id: tenant.id,
      cashAccountId,
      bankAccountId,
      rialDimensionId,
      goldDimensionId,
      coinTypeId: coin.coinTypeId,
      coinDimensionId: coin.dimensionId,
      otherCoinTypeId: otherCoin.coinTypeId,
      otherCoinDimensionId: otherCoin.dimensionId,
    };
  }

  async function createUser(label: string): Promise<string> {
    const id = await insertId(
      `INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id`,
      [`${randomUUID().slice(0, 12)}@example.com`, label],
    );
    userIds.push(id);
    return id;
  }

  async function createParty(tenantId: string): Promise<string> {
    return insertId(
      `INSERT INTO parties (tenant_id, type, display_name, normalized_name)
       VALUES ($1, 'CONSUMER', 'مشتری آزمون', 'مشتری آزمون') RETURNING id`,
      [tenantId],
    );
  }

  async function createJewelryItem(tenantId: string): Promise<string> {
    return insertId(`INSERT INTO jewelry_items (tenant_id, code) VALUES ($1, $2) RETURNING id`, [
      tenantId,
      `BE063-${randomUUID().slice(0, 8)}`,
    ]);
  }

  async function createQuote(tenantId: string, createdBy: string | null = null): Promise<string> {
    return insertId(
      `INSERT INTO price_quotes (tenant_id, quote_type, amount_rial, source, created_by)
       VALUES ($1, 'MAZNEH', 150000000, 'MANUAL', $2) RETURNING id`,
      [tenantId, createdBy],
    );
  }

  async function postBalancedLedgerTransaction(
    tenant: TenantFixture,
    createdBy: string | null = null,
  ): Promise<{ transactionId: string; entryId: string }> {
    let transactionId = '';
    let entryId = '';
    await inTransaction(async (client) => {
      const transaction = await client.query<{ id: string }>(
        `INSERT INTO ledger_transactions (tenant_id, source_type, source_id, effective_at, description, created_by)
         VALUES ($1, 'SETTLEMENT', $2, $3, 'آزمون BE-063', $4) RETURNING id`,
        [tenant.id, randomUUID(), T0, createdBy],
      );
      transactionId = transaction.rows[0]!.id;
      const entries = await client.query<{ id: string }>(
        `INSERT INTO ledger_entries (tenant_id, transaction_id, account_id, dimension_id, quantity)
         VALUES ($1, $2, $3, $5, 1000), ($1, $2, $4, $5, -1000) RETURNING id`,
        [tenant.id, transactionId, tenant.cashAccountId, tenant.bankAccountId, tenant.goldDimensionId],
      );
      entryId = entries.rows[0]!.id;
    });
    return { transactionId, entryId };
  }

  /** یک ردیف معتبر در هر جدول append-only، تا UPDATE/DELETE رویش آزموده شود. */
  async function seedAppendOnlyRows(tenant: TenantFixture): Promise<AppendOnlyRows> {
    const ledger = await postBalancedLedgerTransaction(tenant);
    const inventoryMovementId = await insertId(
      `INSERT INTO inventory_movements (tenant_id, source_type, source_id, item_type, item_id, dimension_id, quantity, occurred_at)
       VALUES ($1, 'CORRECTION', $2, 'MELTED_GOLD', NULL, $3, 5000, $4) RETURNING id`,
      [tenant.id, randomUUID(), tenant.goldDimensionId, T0],
    );
    const auditLogId = await insertId(
      `INSERT INTO audit_logs (tenant_id, action, entity_type, entity_id)
       VALUES ($1, 'be063.test', 'test', 'x') RETURNING id`,
      [tenant.id],
    );
    const openingBalanceId = await insertId(
      `INSERT INTO opening_balances (tenant_id, effective_at, description)
       VALUES ($1, $2, 'آزمون BE-063') RETURNING id`,
      [tenant.id, T0],
    );
    const invoiceId = await insertId(
      `INSERT INTO sales_invoices (tenant_id, invoice_number, current_version, status, party_id,
                                   quote_id, quote_amount_rial, quote_observed_at, finalized_at)
       VALUES ($1, 1, 1, 'FINALIZED', $2, $3, 150000000, $4, $4) RETURNING id`,
      [tenant.id, partyId, quoteId, T0],
    );
    const invoiceVersionId = await insertId(
      `INSERT INTO sales_invoice_versions (tenant_id, sales_invoice_id, version, party_id, totals_snapshot, settings_snapshot)
       VALUES ($1, $2, 1, $3, '{}'::jsonb, '{}'::jsonb) RETURNING id`,
      [tenant.id, invoiceId, partyId],
    );
    const invoiceItemId = await insertId(
      `INSERT INTO sales_invoice_items (tenant_id, sales_invoice_id, sales_invoice_version_id, item_type, item_id, quantity, line_snapshot)
       VALUES ($1, $2, $3, 'COIN', $4, 1, '{}'::jsonb) RETURNING id`,
      [tenant.id, invoiceId, invoiceVersionId, tenant.coinTypeId],
    );
    const settlementId = await insertId(
      `INSERT INTO settlements (tenant_id, party_id, status, effective_at, finalized_at)
       VALUES ($1, $2, 'FINALIZED', $3, $3) RETURNING id`,
      [tenant.id, partyId, T0],
    );
    const settlementLineId = await insertId(
      `INSERT INTO settlement_lines (tenant_id, settlement_id, line_type, dimension_id, quantity, source_account_id, destination_account_id)
       VALUES ($1, $2, 'RIAL', $3, 1000, $4, $5) RETURNING id`,
      [tenant.id, settlementId, tenant.rialDimensionId, tenant.cashAccountId, tenant.bankAccountId],
    );
    const purchaseId = await insertSecondHandPurchase(tenant.id, partyId, quoteId);
    const purchaseItemId = await insertId(
      `INSERT INTO second_hand_purchase_items (tenant_id, second_hand_purchase_id, item_type, destination_inventory_type,
                                               gross_weight_mg, stone_weight_mg, other_deduction_weight_mg,
                                               purchase_karat, pure_weight_mg, item_snapshot)
       VALUES ($1, $2, 'GOLD', 'MELTED_GOLD', 1000, 0, 0, 740, 740, '{}'::jsonb) RETURNING id`,
      [tenant.id, purchaseId],
    );

    return {
      ledger_transactions: ledger.transactionId,
      ledger_entries: ledger.entryId,
      inventory_movements: inventoryMovementId,
      audit_logs: auditLogId,
      price_quotes: quoteId,
      opening_balances: openingBalanceId,
      sales_invoice_versions: invoiceVersionId,
      sales_invoice_items: invoiceItemId,
      settlement_lines: settlementLineId,
      second_hand_purchases: purchaseId,
      second_hand_purchase_items: purchaseItemId,
    };
  }

  async function insertSecondHandPurchase(
    tenantId: string,
    purchasePartyId: string,
    lockedQuoteId: string,
    overrides: { readonly feeRial?: string; readonly finalAmountRial?: string } = {},
  ): Promise<string> {
    return insertId(
      `INSERT INTO second_hand_purchases (tenant_id, party_id, locked_quote_id, locked_quote_amount_rial,
                                          locked_quote_observed_at, settings_snapshot, seller_identity_snapshot,
                                          fee_rial, final_amount_rial, effective_at, finalized_at)
       VALUES ($1, $2, $3, 150000000, $4, '{}'::jsonb, '{}'::jsonb, $5, $6, $4, $4) RETURNING id`,
      [tenantId, purchasePartyId, lockedQuoteId, T0, overrides.feeRial ?? '0', overrides.finalAmountRial ?? '1000'],
    );
  }

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    tenantService = app.get(TenantService);

    a = await createTenantFixture('محدودیت‌ها — مستأجر الف');
    b = await createTenantFixture('محدودیت‌ها — مستأجر ب');
    partyId = await createParty(a.id);
    otherTenantPartyId = await createParty(b.id);
    quoteId = await createQuote(a.id);
    jewelryItemId = await createJewelryItem(a.id);
    otherTenantJewelryItemId = await createJewelryItem(b.id);
    appendOnly = await seedAppendOnlyRows(a);
  });

  afterAll(async () => {
    // تنها مسیر پاک‌سازی: حذف مستأجر که همه‌چیزش را cascade می‌کند.
    for (const tenantId of tenantIds) {
      await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    }
    for (const userId of userIds) {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    }
    await app.close();
    await pool.end();
  });

  it('این آزمون با نقش superuser اجرا می‌شود — یعنی قوی‌ترین حالت SQL مستقیم', async () => {
    const { rolsuper } = await one<{ rolsuper: boolean }>(
      'SELECT rolsuper FROM pg_roles WHERE rolname = current_user',
    );
    expect(rolsuper).toBe(true);
  });

  describe('عیار بین ۱ و ۱۰۰۰', () => {
    it('نسخه‌ی سکه عیار ۰ یا ۱۰۰۱ نمی‌پذیرد', async () => {
      for (const karat of [0, 1001]) {
        await expect(
          pool.query(
            `INSERT INTO coin_type_versions (tenant_id, coin_type_id, title, mint_type, gross_weight_ug, karat,
                                             is_central_bank_minted, valid_from, valid_to, version)
             VALUES ($1, $2, 'آزمون', 'CENTRAL_BANK', 1000, $3, true, $4, $5, 99)`,
            [a.id, a.coinTypeId, karat, FAR_PAST_FROM, FAR_PAST_TO],
          ),
        ).rejects.toMatchObject(rejected('23514', 'coin_type_versions_karat_range_check'));
      }
    });

    it('نسخه‌ی زیورآلات عیار ۰ یا ۱۰۰۱ نمی‌پذیرد', async () => {
      for (const karat of [0, 1001]) {
        await expect(
          pool.query(
            `INSERT INTO jewelry_item_versions (tenant_id, jewelry_item_id, title, normalized_title, gross_weight_mg,
                                                karat, wage_type, wage_value, valid_from, version)
             VALUES ($1, $2, 'آزمون', 'آزمون', 1000, $3, 'FLAT', 0, $4, 1)`,
            [a.id, jewelryItemId, karat, T0],
          ),
        ).rejects.toMatchObject(rejected('23514', 'jewelry_item_versions_karat_range_check'));
      }
    });

    it('ردیف خرید دست‌دوم طلا عیار ۱۰۰۱ نمی‌پذیرد', async () => {
      await expect(
        pool.query(
          `INSERT INTO second_hand_purchase_items (tenant_id, second_hand_purchase_id, item_type, destination_inventory_type,
                                                   gross_weight_mg, stone_weight_mg, other_deduction_weight_mg,
                                                   purchase_karat, pure_weight_mg, item_snapshot)
           VALUES ($1, $2, 'GOLD', 'MELTED_GOLD', 1000, 0, 0, 1001, 1001, '{}'::jsonb)`,
          [a.id, appendOnly.second_hand_purchases],
        ),
      ).rejects.toMatchObject(rejected('23514', 'second_hand_purchase_items_gold_fields_check'));
    });
  });

  describe('وزن و مبلغ: غیرمنفی، مثبت یا signed غیرصفر طبق دامنه', () => {
    it('وزن ناخالص صفر، سنگ منفی و کسورات بیشتر از وزن را رد می‌کند', async () => {
      const cases: ReadonlyArray<readonly [string, string, string, string]> = [
        ['0', '0', '0', 'jewelry_item_versions_gross_weight_positive_check'],
        ['1000', '-1', '0', 'jewelry_item_versions_stone_weight_check'],
        ['1000', '0', '-1', 'jewelry_item_versions_other_deduction_check'],
        ['1000', '600', '500', 'jewelry_item_versions_deduction_within_gross_check'],
      ];
      for (const [gross, stone, other, constraint] of cases) {
        await expect(
          pool.query(
            `INSERT INTO jewelry_item_versions (tenant_id, jewelry_item_id, title, normalized_title, gross_weight_mg,
                                                stone_weight_mg, other_deduction_weight_mg, karat, wage_type,
                                                wage_value, valid_from, version)
             VALUES ($1, $2, 'آزمون', 'آزمون', $3, $4, $5, 750, 'FLAT', 0, $6, 1)`,
            [a.id, jewelryItemId, gross, stone, other, T0],
          ),
        ).rejects.toMatchObject(rejected('23514', constraint));
      }
    });

    it('وزن سکه، مظنه، اجرت منفی و مبلغ نهایی صفر خرید را رد می‌کند', async () => {
      await expect(
        pool.query(
          `INSERT INTO coin_type_versions (tenant_id, coin_type_id, title, mint_type, gross_weight_ug, karat,
                                           is_central_bank_minted, valid_from, valid_to, version)
           VALUES ($1, $2, 'آزمون', 'CENTRAL_BANK', 0, 900, true, $3, $4, 99)`,
          [a.id, a.coinTypeId, FAR_PAST_FROM, FAR_PAST_TO],
        ),
      ).rejects.toMatchObject(rejected('23514', 'coin_type_versions_weight_positive_check'));
      await expect(
        pool.query(
          `INSERT INTO price_quotes (tenant_id, quote_type, amount_rial, source) VALUES ($1, 'MAZNEH', 0, 'MANUAL')`,
          [a.id],
        ),
      ).rejects.toMatchObject(rejected('23514', 'price_quotes_amount_positive_check'));
      await expect(insertSecondHandPurchase(a.id, partyId, quoteId, { feeRial: '-1' })).rejects.toMatchObject(
        rejected('23514', 'second_hand_purchases_fee_nonnegative_check'),
      );
      await expect(
        insertSecondHandPurchase(a.id, partyId, quoteId, { finalAmountRial: '0' }),
      ).rejects.toMatchObject(rejected('23514', 'second_hand_purchases_final_amount_positive_check'));
    });

    it('مقدار صفر را در دفتر کل، موجودی و تسویه رد می‌کند (علامت فقط جهت است)', async () => {
      await expect(
        pool.query(
          `INSERT INTO inventory_movements (tenant_id, source_type, source_id, item_type, item_id, dimension_id, quantity, occurred_at)
           VALUES ($1, 'CORRECTION', $2, 'MELTED_GOLD', NULL, $3, 0, $4)`,
          [a.id, randomUUID(), a.goldDimensionId, T0],
        ),
      ).rejects.toMatchObject(rejected('23514', 'inventory_movements_quantity_nonzero_check'));
      await expect(
        pool.query(
          `INSERT INTO ledger_entries (tenant_id, transaction_id, account_id, dimension_id, quantity)
           VALUES ($1, $2, $3, $4, 0)`,
          [a.id, appendOnly.ledger_transactions, a.cashAccountId, a.goldDimensionId],
        ),
      ).rejects.toMatchObject(rejected('23514', 'ledger_entries_quantity_nonzero_check'));
      await expect(
        pool.query(
          `INSERT INTO settlement_lines (tenant_id, settlement_id, line_type, dimension_id, quantity, source_account_id, destination_account_id)
           SELECT tenant_id, settlement_id, 'RIAL', dimension_id, 0, source_account_id, destination_account_id
           FROM settlement_lines WHERE id = $1`,
          [appendOnly.settlement_lines],
        ),
      ).rejects.toMatchObject(rejected('23514', 'settlement_lines_quantity_positive_check'));
    });

    it('شماره‌ی فاکتور صفر و مبلغ مظنه‌ی قفل‌شده‌ی بی‌شناسه یا صفر را رد می‌کند', async () => {
      await expect(
        pool.query(
          `INSERT INTO sales_invoices (tenant_id, invoice_number, current_version, status, party_id,
                                       quote_id, quote_amount_rial, quote_observed_at, finalized_at)
           VALUES ($1, 0, 1, 'FINALIZED', $2, $3, 150000000, $4, $4)`,
          [a.id, partyId, quoteId, T0],
        ),
      ).rejects.toMatchObject(rejected('23514', 'sales_invoices_number_positive_check'));

      const settlementLine = (lockedQuoteId: string | null, lockedAmount: string | null) =>
        pool.query(
          `INSERT INTO settlement_lines (tenant_id, settlement_id, line_type, dimension_id, quantity, source_account_id,
                                         destination_account_id, locked_quote_id, locked_quote_amount_rial)
           SELECT tenant_id, settlement_id, 'RIAL', dimension_id, 1, source_account_id, destination_account_id, $2, $3
           FROM settlement_lines WHERE id = $1`,
          [appendOnly.settlement_lines, lockedQuoteId, lockedAmount],
        );
      await expect(settlementLine(null, '150000000')).rejects.toMatchObject(
        rejected('23514', 'settlement_lines_locked_quote_complete_check'),
      );
      await expect(settlementLine(quoteId, null)).rejects.toMatchObject(
        rejected('23514', 'settlement_lines_locked_quote_complete_check'),
      );
      await expect(settlementLine(quoteId, '0')).rejects.toMatchObject(
        rejected('23514', 'settlement_lines_locked_quote_amount_positive_check'),
      );
    });

    it('ردیف خرید دست‌دوم با فیلد NULL از check رد نمی‌شود (منطق سه‌مقداری)', async () => {
      await expect(
        pool.query(
          `INSERT INTO second_hand_purchase_items (tenant_id, second_hand_purchase_id, item_type,
                                                   destination_inventory_type, item_snapshot)
           VALUES ($1, $2, 'GOLD', 'MELTED_GOLD', '{}'::jsonb)`,
          [a.id, appendOnly.second_hand_purchases],
        ),
      ).rejects.toMatchObject(rejected('23514', 'second_hand_purchase_items_gold_fields_check'));
      await expect(
        pool.query(
          `INSERT INTO second_hand_purchase_items (tenant_id, second_hand_purchase_id, item_type,
                                                   destination_inventory_type, coin_type_id, item_snapshot)
           VALUES ($1, $2, 'COIN', 'COIN', $3, '{}'::jsonb)`,
          [a.id, appendOnly.second_hand_purchases, a.coinTypeId],
        ),
      ).rejects.toMatchObject(rejected('23514', 'second_hand_purchase_items_coin_fields_check'));
    });
  });

  describe('تعداد سکه عدد صحیح', () => {
    it('تعداد کسری سکه را در خرید، فاکتور، موجودی و تسویه نمی‌پذیرد', async () => {
      await expect(
        pool.query(
          `INSERT INTO second_hand_purchase_items (tenant_id, second_hand_purchase_id, item_type,
                                                   destination_inventory_type, coin_type_id, coin_count, item_snapshot)
           VALUES ($1, $2, 'COIN', 'COIN', $3, '1.5', '{}'::jsonb)`,
          [a.id, appendOnly.second_hand_purchases, a.coinTypeId],
        ),
      ).rejects.toMatchObject(rejected('22P02'));
      await expect(
        pool.query(
          `INSERT INTO sales_invoice_items (tenant_id, sales_invoice_id, sales_invoice_version_id, item_type, item_id, quantity, line_snapshot)
           SELECT tenant_id, sales_invoice_id, sales_invoice_version_id, 'COIN', item_id, '1.5', '{}'::jsonb
           FROM sales_invoice_items WHERE id = $1`,
          [appendOnly.sales_invoice_items],
        ),
      ).rejects.toMatchObject(rejected('22P02'));
      await expect(
        pool.query(
          `INSERT INTO inventory_movements (tenant_id, source_type, source_id, item_type, item_id, dimension_id, quantity, occurred_at)
           VALUES ($1, 'CORRECTION', $2, 'COIN', $3, $4, '2.5', $5)`,
          [a.id, randomUUID(), a.coinTypeId, a.coinDimensionId, T0],
        ),
      ).rejects.toMatchObject(rejected('22P02'));
      await expect(
        pool.query(
          `INSERT INTO settlement_lines (tenant_id, settlement_id, line_type, dimension_id, quantity, source_account_id, destination_account_id)
           SELECT tenant_id, settlement_id, 'COIN', $2, '0.5', source_account_id, destination_account_id
           FROM settlement_lines WHERE id = $1`,
          [appendOnly.settlement_lines, a.coinDimensionId],
        ),
      ).rejects.toMatchObject(rejected('22P02'));
    });

    it('تعداد صفر یا منفی سکه در فاکتور و خرید رد می‌شود', async () => {
      await expect(
        pool.query(
          `INSERT INTO sales_invoice_items (tenant_id, sales_invoice_id, sales_invoice_version_id, item_type, item_id, quantity, line_snapshot)
           SELECT tenant_id, sales_invoice_id, sales_invoice_version_id, 'COIN', item_id, 0, '{}'::jsonb
           FROM sales_invoice_items WHERE id = $1`,
          [appendOnly.sales_invoice_items],
        ),
      ).rejects.toMatchObject(rejected('23514', 'sales_invoice_items_quantity_positive_check'));
      await expect(
        pool.query(
          `INSERT INTO second_hand_purchase_items (tenant_id, second_hand_purchase_id, item_type,
                                                   destination_inventory_type, coin_type_id, coin_count, item_snapshot)
           VALUES ($1, $2, 'COIN', 'COIN', $3, -1, '{}'::jsonb)`,
          [a.id, appendOnly.second_hand_purchases, a.coinTypeId],
        ),
      ).rejects.toMatchObject(rejected('23514', 'second_hand_purchase_items_coin_fields_check'));
    });
  });

  describe('version مثبت و بازه‌ی زمانی معتبر', () => {
    it('version صفر را در هر چهار جدول نسخه‌دار رد می‌کند', async () => {
      await expect(
        pool.query(
          `INSERT INTO versioned_settings (tenant_id, setting_key, value_json, valid_from, valid_to, version)
           VALUES ($1, 'be063.test', '{}'::jsonb, $2, $3, 0)`,
          [a.id, FAR_PAST_FROM, FAR_PAST_TO],
        ),
      ).rejects.toMatchObject(rejected('23514', 'versioned_settings_version_positive_check'));
      await expect(
        pool.query(
          `INSERT INTO coin_type_versions (tenant_id, coin_type_id, title, mint_type, gross_weight_ug, karat,
                                           is_central_bank_minted, valid_from, valid_to, version)
           VALUES ($1, $2, 'آزمون', 'CENTRAL_BANK', 1000, 900, true, $3, $4, 0)`,
          [a.id, a.coinTypeId, FAR_PAST_FROM, FAR_PAST_TO],
        ),
      ).rejects.toMatchObject(rejected('23514', 'coin_type_versions_version_positive_check'));
      await expect(
        pool.query(
          `INSERT INTO jewelry_item_versions (tenant_id, jewelry_item_id, title, normalized_title, gross_weight_mg,
                                              karat, wage_type, wage_value, valid_from, version)
           VALUES ($1, $2, 'آزمون', 'آزمون', 1000, 750, 'FLAT', 0, $3, 0)`,
          [a.id, jewelryItemId, T0],
        ),
      ).rejects.toMatchObject(rejected('23514', 'jewelry_item_versions_version_positive_check'));
      await expect(
        pool.query(
          `INSERT INTO sales_invoice_versions (tenant_id, sales_invoice_id, version, reason, party_id,
                                              totals_snapshot, settings_snapshot)
           SELECT tenant_id, sales_invoice_id, 0, 'WEIGHT_ERROR', party_id, '{}'::jsonb, '{}'::jsonb
           FROM sales_invoice_versions WHERE id = $1`,
          [appendOnly.sales_invoice_versions],
        ),
      ).rejects.toMatchObject(rejected('23514', 'sales_invoice_versions_version_positive_check'));
    });

    it('بازه‌ای که پایانش پیش از یا برابر شروعش است رد می‌شود', async () => {
      await expect(
        pool.query(
          `INSERT INTO versioned_settings (tenant_id, setting_key, value_json, valid_from, valid_to, version)
           VALUES ($1, 'be063.test', '{}'::jsonb, $2, $2, 1)`,
          [a.id, T1],
        ),
      ).rejects.toMatchObject(rejected('23514', 'versioned_settings_valid_interval_check'));
      await expect(
        pool.query(
          `INSERT INTO coin_type_versions (tenant_id, coin_type_id, title, mint_type, gross_weight_ug, karat,
                                           is_central_bank_minted, valid_from, valid_to, version)
           VALUES ($1, $2, 'آزمون', 'CENTRAL_BANK', 1000, 900, true, $3, $4, 99)`,
          [a.id, a.coinTypeId, FAR_PAST_TO, FAR_PAST_FROM],
        ),
      ).rejects.toMatchObject(rejected('23514', 'coin_type_versions_valid_interval_check'));
      await expect(
        pool.query(
          `INSERT INTO jewelry_item_versions (tenant_id, jewelry_item_id, title, normalized_title, gross_weight_mg,
                                              karat, wage_type, wage_value, valid_from, valid_to, version)
           VALUES ($1, $2, 'آزمون', 'آزمون', 1000, 750, 'FLAT', 0, $3, $4, 1)`,
          [a.id, jewelryItemId, T1, T0],
        ),
      ).rejects.toMatchObject(rejected('23514', 'jewelry_item_versions_valid_interval_check'));
    });
  });

  describe('یکتایی tenant-aware', () => {
    it('کد تکراری در یک مستأجر رد می‌شود ولی همان کد در مستأجر دیگر آزاد است', async () => {
      const code = `BE063-DUP-${randomUUID().slice(0, 6)}`;
      await pool.query('INSERT INTO coin_types (tenant_id, code) VALUES ($1, $2)', [a.id, code]);
      await expect(
        pool.query('INSERT INTO coin_types (tenant_id, code) VALUES ($1, $2)', [a.id, code]),
      ).rejects.toMatchObject(rejected('23505', 'coin_types_tenant_code_unique'));
      await expect(
        pool.query('INSERT INTO coin_types (tenant_id, code) VALUES ($1, $2)', [b.id, code]),
      ).resolves.toMatchObject({ rowCount: 1 });

      const itemCode = `BE063-JDUP-${randomUUID().slice(0, 6)}`;
      await pool.query('INSERT INTO jewelry_items (tenant_id, code) VALUES ($1, $2)', [a.id, itemCode]);
      await expect(
        pool.query('INSERT INTO jewelry_items (tenant_id, code) VALUES ($1, $2)', [a.id, itemCode]),
      ).rejects.toMatchObject(rejected('23505', 'jewelry_items_tenant_code_unique'));
      await expect(
        pool.query('INSERT INTO jewelry_items (tenant_id, code) VALUES ($1, $2)', [b.id, itemCode]),
      ).resolves.toMatchObject({ rowCount: 1 });
    });

    it('شماره‌ی فاکتور، کلید idempotency و منبع تراکنش دفتر کل در هر مستأجر یکتا هستند', async () => {
      await expect(
        pool.query(
          `INSERT INTO sales_invoices (tenant_id, invoice_number, current_version, status, party_id,
                                       quote_id, quote_amount_rial, quote_observed_at, finalized_at)
           VALUES ($1, 1, 1, 'FINALIZED', $2, $3, 150000000, $4, $4)`,
          [a.id, partyId, quoteId, T0],
        ),
      ).rejects.toMatchObject(rejected('23505', 'sales_invoices_tenant_number_unique'));

      const key = `be063-${randomUUID()}`;
      const idempotency = (tenantId: string) =>
        pool.query(
          `INSERT INTO idempotency_records (tenant_id, key, request_hash, status, expires_at)
           VALUES ($1, $2, 'hash', 'PENDING', now() + interval '1 day')`,
          [tenantId, key],
        );
      await idempotency(a.id);
      await expect(idempotency(a.id)).rejects.toMatchObject(
        rejected('23505', 'idempotency_records_tenant_key_unique'),
      );
      await expect(idempotency(b.id)).resolves.toMatchObject({ rowCount: 1 });

      await expect(
        pool.query(
          `INSERT INTO ledger_transactions (tenant_id, source_type, source_id, effective_at, description)
           SELECT tenant_id, source_type, source_id, effective_at, description
           FROM ledger_transactions WHERE id = $1`,
          [appendOnly.ledger_transactions],
        ),
      ).rejects.toMatchObject(rejected('23505', 'ledger_transactions_tenant_source_unique'));
    });
  });

  describe('کلیدهای خارجی هم‌مستأجر', () => {
    it('حرکت موجودی به کالای ناموجود یا کالای مستأجر دیگر رد می‌شود', async () => {
      const jewelryMovement = (itemId: string) =>
        pool.query(
          `INSERT INTO inventory_movements (tenant_id, source_type, source_id, item_type, item_id, dimension_id, quantity, occurred_at)
           VALUES ($1, 'CORRECTION', $2, 'JEWELRY', $3, $4, 1, $5)`,
          [a.id, randomUUID(), itemId, a.goldDimensionId, T0],
        );
      await expect(jewelryMovement(randomUUID())).rejects.toMatchObject(
        rejected('23503', 'inventory_movements_tenant_jewelry_item_fk'),
      );
      await expect(jewelryMovement(otherTenantJewelryItemId)).rejects.toMatchObject(
        rejected('23503', 'inventory_movements_tenant_jewelry_item_fk'),
      );
      await expect(jewelryMovement(jewelryItemId)).resolves.toMatchObject({ rowCount: 1 });
    });

    it('ردیف فاکتور به نوع سکه یا کالای مستأجر دیگر وصل نمی‌شود', async () => {
      const invoiceItem = (itemType: 'COIN' | 'JEWELRY', itemId: string) =>
        pool.query(
          `INSERT INTO sales_invoice_items (tenant_id, sales_invoice_id, sales_invoice_version_id, item_type, item_id, quantity, line_snapshot)
           SELECT tenant_id, sales_invoice_id, sales_invoice_version_id, $2, $3, 1, '{}'::jsonb
           FROM sales_invoice_items WHERE id = $1`,
          [appendOnly.sales_invoice_items, itemType, itemId],
        );
      await expect(invoiceItem('COIN', b.coinTypeId)).rejects.toMatchObject(
        rejected('23503', 'sales_invoice_items_tenant_coin_type_fk'),
      );
      await expect(invoiceItem('JEWELRY', otherTenantJewelryItemId)).rejects.toMatchObject(
        rejected('23503', 'sales_invoice_items_tenant_jewelry_item_fk'),
      );
    });

    it('کالایی که تاریخچه‌ی موجودی دارد حذف نمی‌شود', async () => {
      const itemWithHistory = await createJewelryItem(a.id);
      await pool.query(
        `INSERT INTO inventory_movements (tenant_id, source_type, source_id, item_type, item_id, dimension_id, quantity, occurred_at)
         VALUES ($1, 'CORRECTION', $2, 'JEWELRY', $3, $4, 1, $5)`,
        [a.id, randomUUID(), itemWithHistory, a.goldDimensionId, T0],
      );
      await expect(
        pool.query('DELETE FROM jewelry_items WHERE id = $1', [itemWithHistory]),
      ).rejects.toMatchObject(rejected('23503', 'inventory_movements_tenant_jewelry_item_fk'));
    });

    it('دفتر کل، تسویه، خرید و فاکتور به داده‌ی مستأجر دیگر ارجاع نمی‌دهند', async () => {
      await expect(
        pool.query(
          `INSERT INTO ledger_entries (tenant_id, transaction_id, account_id, dimension_id, quantity)
           VALUES ($1, $2, $3, $4, 1)`,
          [a.id, appendOnly.ledger_transactions, b.cashAccountId, a.goldDimensionId],
        ),
      ).rejects.toMatchObject(rejected('23503', 'ledger_entries_tenant_account_fk'));
      await expect(
        pool.query(
          `INSERT INTO settlement_lines (tenant_id, settlement_id, line_type, dimension_id, quantity, source_account_id, destination_account_id)
           SELECT tenant_id, settlement_id, 'RIAL', $2, 1, source_account_id, destination_account_id
           FROM settlement_lines WHERE id = $1`,
          [appendOnly.settlement_lines, b.rialDimensionId],
        ),
      ).rejects.toMatchObject(rejected('23503', 'settlement_lines_tenant_dimension_fk'));
      await expect(
        pool.query(
          `INSERT INTO second_hand_purchase_items (tenant_id, second_hand_purchase_id, item_type,
                                                   destination_inventory_type, coin_type_id, coin_count, item_snapshot)
           VALUES ($1, $2, 'COIN', 'COIN', $3, 1, '{}'::jsonb)`,
          [a.id, appendOnly.second_hand_purchases, b.coinTypeId],
        ),
      ).rejects.toMatchObject(rejected('23503', 'second_hand_purchase_items_tenant_coin_type_fk'));
      await expect(insertSecondHandPurchase(a.id, otherTenantPartyId, quoteId)).rejects.toMatchObject(
        rejected('23503', 'second_hand_purchases_tenant_party_fk'),
      );
      await expect(
        pool.query(
          `INSERT INTO sales_invoices (tenant_id, status, party_id) VALUES ($1, 'DRAFT', $2)`,
          [a.id, otherTenantPartyId],
        ),
      ).rejects.toMatchObject(rejected('23503', 'sales_invoices_tenant_party_fk'));
    });
  });

  describe('همخوانی نوع با بُعد (سکه هرگز روی بُعد وزن)', () => {
    const movement = (itemType: string, itemId: string | null, dimensionId: string) =>
      pool.query(
        `INSERT INTO inventory_movements (tenant_id, source_type, source_id, item_type, item_id, dimension_id, quantity, occurred_at)
         VALUES ($1, 'CORRECTION', $2, $3, $4, $5, 1, $6)`,
        [a.id, randomUUID(), itemType, itemId, dimensionId, T0],
      );

    it('حرکت سکه روی بُعد طلا یا بُعد سکه‌ی دیگر رد می‌شود', async () => {
      await expect(movement('COIN', a.coinTypeId, a.goldDimensionId)).rejects.toMatchObject(
        rejected('23514', 'inventory_movements_dimension_matches_item_check'),
      );
      await expect(movement('COIN', a.coinTypeId, a.otherCoinDimensionId)).rejects.toMatchObject(
        rejected('23514', 'inventory_movements_dimension_matches_item_check'),
      );
      await expect(movement('COIN', a.coinTypeId, a.coinDimensionId)).resolves.toMatchObject({ rowCount: 1 });
    });

    it('حرکت زیورآلات یا آبشده فقط روی بُعد طلا', async () => {
      await expect(movement('JEWELRY', jewelryItemId, a.coinDimensionId)).rejects.toMatchObject(
        rejected('23514', 'inventory_movements_dimension_matches_item_check'),
      );
      await expect(movement('MELTED_GOLD', null, a.rialDimensionId)).rejects.toMatchObject(
        rejected('23514', 'inventory_movements_dimension_matches_item_check'),
      );
    });

    it('ردیف تسویه فقط روی بُعد هم‌نوع خودش (CREDIT روی ریال)', async () => {
      const line = (lineType: string, dimensionId: string) =>
        pool.query(
          `INSERT INTO settlement_lines (tenant_id, settlement_id, line_type, dimension_id, quantity, source_account_id, destination_account_id)
           SELECT tenant_id, settlement_id, $2, $3, 1, source_account_id, destination_account_id
           FROM settlement_lines WHERE id = $1`,
          [appendOnly.settlement_lines, lineType, dimensionId],
        );
      await expect(line('COIN', a.rialDimensionId)).rejects.toMatchObject(
        rejected('23514', 'settlement_lines_dimension_matches_type_check'),
      );
      await expect(line('GOLD', a.coinDimensionId)).rejects.toMatchObject(
        rejected('23514', 'settlement_lines_dimension_matches_type_check'),
      );
      await expect(line('CREDIT', a.goldDimensionId)).rejects.toMatchObject(
        rejected('23514', 'settlement_lines_dimension_matches_type_check'),
      );
      await expect(line('CREDIT', a.rialDimensionId)).resolves.toMatchObject({ rowCount: 1 });
    });
  });

  describe('جلوگیری از overlap و بازنویسی تنظیمات نسخه‌دار', () => {
    it('نسخه‌ی باز جدید روی نسخه‌ی باز فعلی تنظیمات و سکه نمی‌نشیند', async () => {
      await expect(
        pool.query(
          `INSERT INTO versioned_settings (tenant_id, setting_key, value_json, valid_from, version)
           VALUES ($1, 'pricing.base_quote_karat', '{"value":"705"}'::jsonb, now() + interval '1 day', 99)`,
          [a.id],
        ),
      ).rejects.toMatchObject(rejected('23P01', 'versioned_settings_no_overlapping_validity'));
      await expect(
        pool.query(
          `INSERT INTO coin_type_versions (tenant_id, coin_type_id, title, mint_type, gross_weight_ug, karat,
                                           is_central_bank_minted, valid_from, version)
           VALUES ($1, $2, 'آزمون', 'CENTRAL_BANK', 1000, 900, true, now() + interval '1 day', 99)`,
          [a.id, a.coinTypeId],
        ),
      ).rejects.toMatchObject(rejected('23P01', 'coin_type_versions_no_overlapping_validity'));
    });

    it('نسخه‌های زیورآلات هم‌پوشانی ندارند و فقط عنوان، فعال بودن و بستن بازه‌ی نسخه‌ی باز عوض می‌شود', async () => {
      const itemId = await createJewelryItem(a.id);
      const version = (validFrom: string, validTo: string | null, versionNumber: number) =>
        pool.query<{ id: string }>(
          `INSERT INTO jewelry_item_versions (tenant_id, jewelry_item_id, title, normalized_title, gross_weight_mg,
                                              karat, wage_type, wage_value, valid_from, valid_to, version)
           VALUES ($1, $2, 'انگشتر', 'انگشتر', 2000, 750, 'FLAT', 0, $3, $4, $5) RETURNING id`,
          [a.id, itemId, validFrom, validTo, versionNumber],
        );
      const firstId = (await version(T0, null, 1)).rows[0]!.id;

      await expect(version(T1, null, 2)).rejects.toMatchObject(
        rejected('23P01', 'jewelry_item_versions_no_overlapping_validity'),
      );
      await expect(
        pool.query('UPDATE jewelry_item_versions SET gross_weight_mg = 1 WHERE id = $1', [firstId]),
      ).rejects.toMatchObject(rejected('55000'));
      await expect(
        pool.query('UPDATE jewelry_item_versions SET karat = 999 WHERE id = $1', [firstId]),
      ).rejects.toMatchObject(rejected('55000'));

      await expect(
        pool.query(
          `UPDATE jewelry_item_versions SET title = 'انگشتر نو', normalized_title = 'انگشتر نو', active = false
           WHERE id = $1`,
          [firstId],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        pool.query('UPDATE jewelry_item_versions SET valid_to = $2 WHERE id = $1', [firstId, T1]),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(version(T1, null, 2)).resolves.toMatchObject({ rowCount: 1 });

      await expect(
        pool.query(`UPDATE jewelry_item_versions SET title = 'بازنویسی' WHERE id = $1`, [firstId]),
      ).rejects.toMatchObject(rejected('55000'));
      await expect(
        pool.query('UPDATE jewelry_item_versions SET valid_to = NULL WHERE id = $1', [firstId]),
      ).rejects.toMatchObject(rejected('55000'));
      await expect(version(T0, T2, 3)).rejects.toMatchObject(
        rejected('23P01', 'jewelry_item_versions_no_overlapping_validity'),
      );
    });

    it('هیچ نسخه‌ی تاریخی‌ای حذف نمی‌شود', async () => {
      for (const table of ['versioned_settings', 'coin_type_versions']) {
        await expect(
          pool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [a.id]),
        ).rejects.toMatchObject(rejected('55000'));
      }
      await expect(
        pool.query('DELETE FROM jewelry_item_versions WHERE tenant_id = $1', [a.id]),
      ).rejects.toMatchObject(rejected('55000'));
    });
  });

  describe('Append-Only: دفتر کل، حرکات موجودی و سندهای مالی برای هیچ نقشی', () => {
    const tables = [
      'ledger_transactions',
      'ledger_entries',
      'inventory_movements',
      'audit_logs',
      'price_quotes',
      'opening_balances',
      'sales_invoice_versions',
      'sales_invoice_items',
      'settlement_lines',
      'second_hand_purchases',
      'second_hand_purchase_items',
    ] as const;

    it.each(tables)('%s با نقش superuser نه UPDATE می‌شود نه DELETE', async (table) => {
      const id = appendOnly[table];
      expect(id).toBeDefined();

      await expect(
        pool.query(`UPDATE ${table} SET created_at = created_at WHERE id = $1`, [id]),
      ).rejects.toMatchObject(rejected('55000'));
      await expect(pool.query(`DELETE FROM ${table} WHERE id = $1`, [id])).rejects.toMatchObject(
        rejected('55000'),
      );
      const { count } = await one<{ count: string }>(`SELECT count(*) FROM ${table} WHERE id = $1`, [id]);
      expect(count).toBe('1');
    });

    it('مقدار و حساب ردیف دفتر کل با هیچ نقشی بازنویسی نمی‌شود', async () => {
      await expect(
        pool.query('UPDATE ledger_entries SET quantity = quantity * 2 WHERE tenant_id = $1', [a.id]),
      ).rejects.toMatchObject(rejected('55000'));

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL ROLE ${APP_DATABASE_ROLE}`);
        await client.query('SELECT set_config($1, $2, true)', [TENANT_SETTING, a.id]);
        await expect(
          client.query('DELETE FROM ledger_entries WHERE id = $1', [appendOnly.ledger_entries]),
        ).rejects.toMatchObject(rejected('55000'));
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('حرکت موجودی با superuser هم جابه‌جا نمی‌شود', async () => {
      await expect(
        pool.query('UPDATE inventory_movements SET quantity = -quantity WHERE tenant_id = $1', [a.id]),
      ).rejects.toMatchObject(rejected('55000'));
      await expect(
        pool.query('DELETE FROM inventory_movements WHERE tenant_id = $1', [a.id]),
      ).rejects.toMatchObject(rejected('55000'));
    });

    it('شماره‌ی فاکتور صادرشده با superuser هم عوض نمی‌شود', async () => {
      await expect(
        pool.query('UPDATE sales_invoices SET invoice_number = 99 WHERE tenant_id = $1 AND invoice_number = 1', [
          a.id,
        ]),
      ).rejects.toMatchObject(rejected('55000'));
    });

    it('حذف کاربر فقط ارجاع سازنده را NULL می‌کند؛ همان کار با UPDATE مستقیم رد می‌شود', async () => {
      const userId = await createUser('سازنده‌ی آزمون');
      const ownQuoteId = await createQuote(a.id, userId);
      const ledger = await postBalancedLedgerTransaction(a, userId);

      await expect(
        pool.query('UPDATE price_quotes SET created_by = NULL WHERE id = $1', [ownQuoteId]),
      ).rejects.toMatchObject(rejected('55000'));

      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      const quote = await one<{ createdBy: string | null; amountRial: string }>(
        `SELECT created_by AS "createdBy", amount_rial::text AS "amountRial" FROM price_quotes WHERE id = $1`,
        [ownQuoteId],
      );
      expect(quote).toEqual({ createdBy: null, amountRial: '150000000' });
      const transaction = await one<{ createdBy: string | null }>(
        'SELECT created_by AS "createdBy" FROM ledger_transactions WHERE id = $1',
        [ledger.transactionId],
      );
      expect(transaction.createdBy).toBeNull();
    });

    it('حذف کامل مستأجر هنوز همه‌ی داده‌ی append-only اش را cascade می‌کند', async () => {
      const purged = await createTenantFixture('محدودیت‌ها — پاک‌سازی');
      const purgedPartyId = await createParty(purged.id);
      const purgedQuoteId = await createQuote(purged.id);
      const purgedItemId = await createJewelryItem(purged.id);
      await postBalancedLedgerTransaction(purged);
      await pool.query(
        `INSERT INTO inventory_movements (tenant_id, source_type, source_id, item_type, item_id, dimension_id, quantity, occurred_at)
         VALUES ($1, 'CORRECTION', $2, 'JEWELRY', $3, $4, 1, $5)`,
        [purged.id, randomUUID(), purgedItemId, purged.goldDimensionId, T0],
      );
      await insertSecondHandPurchase(purged.id, purgedPartyId, purgedQuoteId);

      await pool.query('DELETE FROM tenants WHERE id = $1', [purged.id]);

      const remaining = await one<{ total: string }>(
        `SELECT (
           (SELECT count(*) FROM ledger_entries WHERE tenant_id = $1) +
           (SELECT count(*) FROM ledger_transactions WHERE tenant_id = $1) +
           (SELECT count(*) FROM inventory_movements WHERE tenant_id = $1) +
           (SELECT count(*) FROM price_quotes WHERE tenant_id = $1) +
           (SELECT count(*) FROM second_hand_purchases WHERE tenant_id = $1) +
           (SELECT count(*) FROM versioned_settings WHERE tenant_id = $1) +
           (SELECT count(*) FROM coin_type_versions WHERE tenant_id = $1) +
           (SELECT count(*) FROM audit_logs WHERE tenant_id = $1)
         )::text AS total`,
        [purged.id],
      );
      expect(remaining.total).toBe('0');
    });
  });
});
