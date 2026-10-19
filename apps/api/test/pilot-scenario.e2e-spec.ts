import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  amendedSalesInvoiceSchema,
  b2cBuybackPreviewSchema,
  b2cBuybackSchema,
  coinSaleSchema,
  coinTypeVersionSchema,
  generalSettingSchema,
  goldSettlementSchema,
  jewelryCashSaleSchema,
  jewelryItemVersionSchema,
  openingBalanceSchema,
  partyBalanceReportSchema,
  partyBalancesSchema,
  partySchema,
  partyStatementSchema,
  priceQuoteSchema,
  profitReportSchema,
  rialSettlementSchema,
  salesInvoiceDetailSchema,
  secondHandGoldPurchaseSchema,
  tenantExportDocumentSchema,
  tenantExportSchema,
} from '@gold/contracts';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/platform/auth/password.service';
import { IDEMPOTENCY_KEY_HEADER } from '../src/platform/idempotency/idempotency-key';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ZodTypeAny, z } from 'zod';

const PASSWORD = 'pilot-scenario-password-1';
/** تنظیم تازه‌ی مستأجر در گام ۳؛ خرید دست‌دوم و مرجوعی B2C باید همین را به کار ببرند، نه پیش‌فرض ۷۴۰. */
const PURCHASE_KARAT = 745;

type Response = {
  readonly statusCode: number;
  readonly headers: Record<string, unknown>;
  readonly body: string;
  readonly rawPayload: Buffer;
  json<T>(): T;
};

/**
 * سناریوی کامل پایلوت — BE-072.
 *
 * یک روز کاری واقعی یک طلافروشی، گام‌به‌گام و فقط از مسیر HTTP ِ محصول (همان
 * درخواست‌هایی که فرانت می‌فرستد)، با نقش واقعی هر کار: صندوقدار فروش و دریافت
 * را ثبت می‌کند و مالک تنظیمات، مظنه، موجودی و خروجی را. هر پاسخ با schema ِ
 * `@gold/contracts` خوانده می‌شود.
 *
 * ساخت مستأجر و کاربرها از سرویس‌های برنامه است، چون فاز ۱ برای آن‌ها endpoint ِ
 * محصول ندارد (کار عملیاتی پیش از تحویل است). **هیچ SQL ِ نوشتنی** در کل سناریو
 * نیست؛ SQL فقط در پایان برای خواندن و بررسی ناورداها به کار می‌رود.
 */
describe('سناریوی کامل پایلوت (BE-072)', () => {
  const adapter = new FastifyAdapter();
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://gold:gold@localhost:5432/gold_test',
  });
  const scenarioStart = new Date(Date.now() - 1_000).toISOString();
  let app: NestFastifyApplication;

  const tenant = { id: '', slug: `pilot-${randomUUID().slice(0, 12)}` };
  const tokens = { owner: '', cashier: '' };
  const ids = {
    ownerId: '',
    cashierId: '',
    quoteId: '',
    partyId: '',
    coinTypeId: '',
    jewelryA: '',
    jewelryB: '',
    cashInvoiceId: '',
    coinInvoiceId: '',
    rialSettlementId: '',
    goldSettlementId: '',
    purchaseId: '',
    buybackId: '',
  };
  let profitTo = '';

  function http(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    token: string,
    payload?: object,
  ): Promise<Response> {
    return adapter.getInstance().inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': tenant.id,
        ...(method === 'GET' ? {} : { [IDEMPOTENCY_KEY_HEADER]: randomUUID() }),
      },
      ...(payload === undefined ? {} : { payload }),
    }) as Promise<Response>;
  }

  /** پاسخ موفق را با قرارداد مشترک می‌خواند؛ شکست پیام خود سرور را نشان می‌دهد. */
  function read<T extends ZodTypeAny>(response: Response, status: number, schema: T): z.infer<T> {
    expect(response.statusCode, response.body).toBe(status);
    return schema.parse(response.json()) as z.infer<T>;
  }

  const now = (): string => new Date().toISOString();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();
  });

  afterAll(async () => {
    if (tenant.id !== '') {
      await pool.query('DELETE FROM tenants WHERE id = $1', [tenant.id]);
    }
    await app.close();
    await pool.end();
  });

  it('۱. ایجاد مستأجر — با تنظیمات، ابعاد، حساب‌ها و انواع سکه‌ی اولیه', async () => {
    tenant.id = (await app.get(TenantService).create({ name: 'طلافروشی پایلوت', slug: tenant.slug })).id;

    const { rows } = await pool.query<{ settings: number; dimensions: number; accounts: number; coins: number }>(
      `SELECT (SELECT count(*)::int FROM versioned_settings WHERE tenant_id = $1) AS settings,
              (SELECT count(*)::int FROM asset_dimensions WHERE tenant_id = $1) AS dimensions,
              (SELECT count(*)::int FROM ledger_accounts WHERE tenant_id = $1) AS accounts,
              (SELECT count(*)::int FROM coin_types WHERE tenant_id = $1) AS coins`,
      [tenant.id],
    );
    expect(rows[0]!.settings).toBeGreaterThan(0);
    expect(rows[0]!.dimensions).toBeGreaterThan(1);
    expect(rows[0]!.accounts).toBeGreaterThan(0);
    expect(rows[0]!.coins).toBeGreaterThan(0);
  });

  it('۲. ایجاد OWNER و CASHIER و ورود هر دو', async () => {
    const users = app.get(UserService);
    const passwords = app.get(PasswordService);
    const memberships = app.get(MembershipService);

    for (const role of ['OWNER', 'CASHIER'] as const) {
      const user = await users.create({
        email: `${role.toLowerCase()}-${randomUUID().slice(0, 10)}@example.com`,
        displayName: role === 'OWNER' ? 'مالک طلافروشی' : 'صندوقدار',
      });
      await users.setPasswordHash(user.id, await passwords.hash(PASSWORD));
      await memberships.add(tenant.id, { userId: user.id, roleCode: role });

      const login = await adapter.getInstance().inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, password: PASSWORD, tenantSlug: tenant.slug },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json<{ role: string }>().role).toBe(role);
      if (role === 'OWNER') {
        tokens.owner = login.json<{ accessToken: string }>().accessToken;
        ids.ownerId = user.id;
      } else {
        tokens.cashier = login.json<{ accessToken: string }>().accessToken;
        ids.cashierId = user.id;
      }
    }
  });

  it('۳. ثبت تنظیمات: عیار خرید دست‌دوم و پنجره‌ی اصلاح — فقط مالک', async () => {
    const denied = await http('POST', '/settings/general', tokens.cashier, {
      key: 'purchase.second_hand_default_karat',
      value: String(PURCHASE_KARAT),
    });
    expect(denied.statusCode).toBe(403);

    const karat = read(
      await http('POST', '/settings/general', tokens.owner, {
        key: 'purchase.second_hand_default_karat',
        value: String(PURCHASE_KARAT),
      }),
      201,
      generalSettingSchema,
    );
    const window = read(
      await http('POST', '/settings/general', tokens.owner, {
        key: 'sales.invoice_correction_window_minutes',
        value: '1440',
      }),
      201,
      generalSettingSchema,
    );
    expect(karat).toMatchObject({ value: String(PURCHASE_KARAT), version: 2 });
    expect(window).toMatchObject({ value: '1440', version: 2 });
  });

  it('۴. ثبت مظنه', async () => {
    const quote = read(
      await http('POST', '/pricing/quotes/manual', tokens.owner, { quoteType: 'MAZNEH', amountRial: '100000000' }),
      201,
      priceQuoteSchema,
    );
    ids.quoteId = quote.id;
    expect(quote).toMatchObject({ quoteType: 'MAZNEH', amountRial: '100000000', source: 'MANUAL' });
  });

  it('۵. ایجاد مشتری (صندوقدار)', async () => {
    const party = read(
      await http('POST', '/parties', tokens.cashier, {
        type: 'CONSUMER',
        displayName: 'مریم احمدی',
        mobile: '09121112233',
        nationalId: '0012345678',
      }),
      201,
      partySchema,
    );
    ids.partyId = party.id;
  });

  it('۶. موجودی اولیه‌ی زیورآلات و سکه (مالک)', async () => {
    const coins = read(
      await http('GET', '/inventory/coin-types', tokens.owner),
      200,
      coinTypeVersionSchema.array(),
    );
    const bahar = coins.find((coin) => coin.mintType === 'CENTRAL_BANK' && coin.active);
    expect(bahar).toBeDefined();
    ids.coinTypeId = bahar!.coinTypeId;

    for (const [key, code, grossWeightMg] of [
      ['jewelryA', 'PILOT-RING-1', '8000'],
      ['jewelryB', 'PILOT-RING-2', '6500'],
    ] as const) {
      const item = read(
        await http('POST', '/inventory/jewelry-items', tokens.owner, {
          code,
          title: `انگشتر ${code}`,
          grossWeightMg,
          karat: 750,
          stoneWeightMg: '0',
          otherDeductionWeightMg: '0',
          wageType: 'PER_GRAM',
          wageValue: '3000000',
        }),
        201,
        jewelryItemVersionSchema,
      );
      ids[key] = item.jewelryItemId;
    }

    const opening = read(
      await http('POST', '/inventory/opening-balances', tokens.owner, {
        // موجودی افتتاحیه پس از تعریف کالا و سکه — نوع سکه از لحظه‌ی ساخت مستأجر فعال است.
        effectiveAt: now(),
        description: 'موجودی افتتاحیه‌ی پایلوت',
        lines: [
          { itemType: 'JEWELRY', itemId: ids.jewelryA, quantity: '1' },
          { itemType: 'JEWELRY', itemId: ids.jewelryB, quantity: '1' },
          { itemType: 'COIN', itemId: ids.coinTypeId, quantity: '10' },
        ],
      }),
      201,
      openingBalanceSchema,
    );
    expect(opening.ledgerTransactionId).toBeDefined();
  });

  it('۷. فروش نقدی زیورآلات (صندوقدار)', async () => {
    const sale = read(
      await http('POST', '/sales/invoices/jewelry', tokens.cashier, {
        partyId: ids.partyId,
        jewelryItemId: ids.jewelryA,
        quoteId: ids.quoteId,
        effectiveAt: now(),
      }),
      201,
      jewelryCashSaleSchema,
    );
    ids.cashInvoiceId = sale.invoiceId;
    expect(sale.invoiceNumber).toBe(1);
    expect(BigInt(sale.payableRial)).toBeGreaterThan(0n);
  });

  it('۸. فروش نسیه‌ی سکه: ۳ سکه، بخشی نقد', async () => {
    const sale = read(
      await http('POST', '/sales/invoices/coins', tokens.cashier, {
        partyId: ids.partyId,
        coinTypeId: ids.coinTypeId,
        count: 3,
        marketUnitPriceRial: '1200000000',
        quoteId: ids.quoteId,
        effectiveAt: now(),
        paidRial: '1000000000',
      }),
      201,
      coinSaleSchema,
    );
    ids.coinInvoiceId = sale.invoiceId;
    expect(sale).toMatchObject({ invoiceNumber: 2, payableRial: '3600000000', receivableRial: '2600000000' });
    // سکه‌ی ضرب بانک مرکزی حباب دارد.
    expect(sale.bubbleRial).not.toBeNull();
  });

  it('۹. پرداخت بخشی از مانده با ریال', async () => {
    const settlement = read(
      await http('POST', `/parties/${ids.partyId}/settlements/rial`, tokens.cashier, {
        amountRial: '500000000',
        effectiveAt: now(),
      }),
      201,
      rialSettlementSchema,
    );
    ids.rialSettlementId = settlement.settlementId;
  });

  it('۱۰. پرداخت بخشی با طلا (نرخ همان لحظه قفل می‌شود)', async () => {
    const settlement = read(
      await http('POST', `/parties/${ids.partyId}/settlements/gold`, tokens.cashier, {
        grossWeightMg: '5000',
        karat: 750,
        quoteId: ids.quoteId,
        effectiveAt: now(),
      }),
      201,
      goldSettlementSchema,
    );
    ids.goldSettlementId = settlement.settlementId;
    expect(settlement.pureWeightMg).toBe('3750');
    expect(BigInt(settlement.settledRial)).toBeGreaterThan(0n);
  });

  it('۱۱. خرید طلای دست‌دوم از مصرف‌کننده با عیار تنظیم‌شده‌ی مستأجر', async () => {
    const purchase = read(
      await http('POST', '/purchase/second-hand/gold', tokens.cashier, {
        partyId: ids.partyId,
        grossWeightMg: '4000',
        quoteId: ids.quoteId,
        effectiveAt: now(),
      }),
      201,
      secondHandGoldPurchaseSchema,
    );
    ids.purchaseId = purchase.secondHandPurchaseId;
    expect(purchase.pureWeightMg).toBe(((4000n * BigInt(PURCHASE_KARAT)) / 1000n).toString());
  });

  it('۱۲. مرجوعی B2C متصل به فاکتور: پیش‌نمایش، بعد ثبت به‌عنوان خرید دست‌دوم', async () => {
    const preview = read(
      await http('POST', `/sales/invoices/${ids.cashInvoiceId}/b2c-buyback/preview`, tokens.cashier, {
        grossWeightMg: '8000',
        quoteId: ids.quoteId,
        effectiveAt: now(),
      }),
      200,
      b2cBuybackPreviewSchema,
    );
    expect(preview.sourceInvoiceId).toBe(ids.cashInvoiceId);

    const buyback = read(
      await http('POST', `/sales/invoices/${ids.cashInvoiceId}/b2c-buyback`, tokens.cashier, {
        grossWeightMg: '8000',
        quoteId: ids.quoteId,
        effectiveAt: now(),
      }),
      201,
      b2cBuybackSchema,
    );
    ids.buybackId = buyback.secondHandPurchaseId;
    expect(buyback.sourceInvoiceId).toBe(ids.cashInvoiceId);
    expect(buyback.pureWeightMg).toBe(((8000n * BigInt(PURCHASE_KARAT)) / 1000n).toString());
  });

  it('۱۳. اصلاح فاکتور سکه: ۳ ← ۲ سکه — صندوقدار تأیید لازم دارد، مالک اصلاح می‌کند', async () => {
    const amendment = {
      reason: 'OTHER',
      reasonDetail: 'تعداد سکه اشتباه ثبت شده بود',
      partyId: ids.partyId,
      item: {
        itemType: 'COIN',
        coinTypeId: ids.coinTypeId,
        count: 2,
        marketUnitPriceRial: '1200000000',
        paidRial: '1000000000',
      },
    };

    // اختلاف ۱٫۲ میلیارد ریال از حد مجاز صندوقدار بیشتر است: قاعده‌ی کسب‌وکار، با پیام روشن — نه ۵۰۰.
    const denied = await http('POST', `/sales/invoices/${ids.coinInvoiceId}/amend`, tokens.cashier, amendment);
    expect(denied.statusCode, denied.body).toBe(403);
    expect(denied.json<{ error: { code: string; message: string } }>().error).toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('تأیید مدیر یا مالک') as string,
    });

    const amended = read(
      await http('POST', `/sales/invoices/${ids.coinInvoiceId}/amend`, tokens.owner, amendment),
      201,
      amendedSalesInvoiceSchema,
    );
    expect(amended).toMatchObject({ invoiceId: ids.coinInvoiceId, version: 2, payableRial: '2400000000', receivableRial: '1400000000' });

    const detail = read(
      await http('GET', `/sales/invoices/${ids.coinInvoiceId}/detail`, tokens.cashier),
      200,
      salesInvoiceDetailSchema,
    );
    expect(detail.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(detail.versions.every((version) => version.ledgerSummary.balanced)).toBe(true);
    profitTo = now();
  });

  it('۱۴ و ۱۵. مانده‌ی طرف حساب با صورت‌حساب هم‌خوان است', async () => {
    const balances = read(
      await http('GET', `/parties/${ids.partyId}/balances`, tokens.cashier),
      200,
      partyBalancesSchema,
    );
    const statement = read(
      await http('GET', `/parties/${ids.partyId}/statement?limit=200`, tokens.cashier),
      200,
      partyStatementSchema,
    );

    const sum = (kind: string): bigint =>
      statement.items
        .filter((entry) => entry.dimension.kind === kind)
        .reduce((total, entry) => total + BigInt(entry.quantity), 0n);
    expect(statement.total).toBe(statement.items.length);
    expect(sum('RIAL').toString()).toBe(balances.rawBalances.rial);
    expect(sum('GOLD').toString()).toBe(balances.rawBalances.pureGoldMg);

    const sources = new Set(statement.items.map((entry) => entry.source.id));
    // فروش نقدی کامل اثری بر مانده‌ی شخص ندارد (docs/accounting-postings.md ۵.۲)، پس در صورت‌حساب نیست.
    expect(sources.has(ids.cashInvoiceId)).toBe(false);
    for (const [name, id] of Object.entries({
      coinInvoice: ids.coinInvoiceId,
      rialSettlement: ids.rialSettlementId,
      goldSettlement: ids.goldSettlementId,
      purchase: ids.purchaseId,
      buyback: ids.buybackId,
    })) {
      expect({ name, inStatement: sources.has(id) }).toEqual({ name, inStatement: true });
    }
    expect(statement.items.some((entry) => entry.source.type === 'SALES_INVOICE_AMENDMENT')).toBe(true);
  });

  it('۱۶. گزارش بدهکاران: مشتری با همان مانده‌ی خام، در هر دو واحد', async () => {
    const balances = read(await http('GET', `/parties/${ids.partyId}/balances`, tokens.owner), 200, partyBalancesSchema);

    for (const unit of ['GOLD', 'RIAL'] as const) {
      const report = read(
        await http('GET', `/reporting/debtors?referenceQuoteId=${ids.quoteId}&displayUnit=${unit}`, tokens.owner),
        200,
        partyBalanceReportSchema,
      );
      const row = report.items.find((item) => item.party.id === ids.partyId);
      expect(report.displayUnit).toBe(unit);
      expect(row).toBeDefined();
      expect(row!.convertibleDirection).toBe('DEBTOR');
      expect(row!.rawBalances.rial).toBe(balances.rawBalances.rial);
    }
  });

  it('۱۷. سود به طلا و ریال', async () => {
    const report = read(
      await http('GET', `/reporting/profit?from=${encodeURIComponent(scenarioStart)}&to=${encodeURIComponent(profitTo)}`, tokens.owner),
      200,
      profitReportSchema,
    );
    for (const measure of [report.revenue, report.grossProfit, report.totalProfit]) {
      expect(typeof measure.rial).toBe('string');
      expect(typeof measure.goldEquivalentMg).toBe('string');
    }
    expect(BigInt(report.revenue.rial)).toBeGreaterThan(0n);
    expect(BigInt(report.revenue.goldEquivalentMg)).toBeGreaterThan(0n);
  });

  it('۱۸. تولید PDF فاکتور، صورت‌حساب و رسید خرید', async () => {
    for (const url of [
      `/sales/invoices/${ids.cashInvoiceId}/pdf`,
      `/sales/invoices/${ids.coinInvoiceId}/pdf`,
      `/parties/${ids.partyId}/statement/pdf`,
      `/purchase/second-hand/${ids.purchaseId}/pdf`,
    ]) {
      const pdf = await http('GET', url, tokens.cashier);
      expect({ url, status: pdf.statusCode }).toEqual({ url, status: 200 });
      expect(pdf.headers['content-type']).toMatch(/^application\/pdf/u);
      expect(pdf.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    }
  });

  it('۱۹. خروجی کامل مستأجر (فقط مالک) همه‌ی سندهای سناریو را دارد', async () => {
    expect((await http('POST', '/platform/exports/full', tokens.cashier)).statusCode).toBe(403);

    const created = read(await http('POST', '/platform/exports/full', tokens.owner), 201, tenantExportSchema);
    const download = await http('GET', `/platform/exports/${created.id}`, tokens.owner);
    expect(download.statusCode).toBe(200);
    const document = tenantExportDocumentSchema.parse(JSON.parse(download.body));

    const idsIn = (section: string): string[] => document.sections[section]!.rows.map((row) => String(row.id));
    expect(idsIn('salesInvoices').sort()).toEqual([ids.cashInvoiceId, ids.coinInvoiceId].sort());
    expect(idsIn('secondHandPurchases').sort()).toEqual([ids.purchaseId, ids.buybackId].sort());
    expect(idsIn('settlements').sort()).toEqual([ids.rialSettlementId, ids.goldSettlementId].sort());
    expect(document.sections['salesInvoiceVersions']!.rowCount).toBe(3);
  });

  it('۲۰. تراز همه‌ی ledger transactionها و نبود موجودی منفی', async () => {
    const { rows: unbalanced } = await pool.query(
      `SELECT transaction_id, dimension_id, sum(quantity)::text AS total
       FROM ledger_entries WHERE tenant_id = $1
       GROUP BY transaction_id, dimension_id HAVING sum(quantity) <> 0`,
      [tenant.id],
    );
    const { rows: empty } = await pool.query(
      `SELECT id FROM ledger_transactions t WHERE t.tenant_id = $1
         AND NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.tenant_id = t.tenant_id AND e.transaction_id = t.id)`,
      [tenant.id],
    );
    const { rows: negative } = await pool.query(
      `SELECT item_type, item_id, sum(quantity)::text AS balance FROM inventory_movements
       WHERE tenant_id = $1 GROUP BY item_type, item_id HAVING sum(quantity) < 0`,
      [tenant.id],
    );
    const { rows: counts } = await pool.query<{ transactions: number; sources: string[] }>(
      `SELECT count(*)::int AS transactions, array_agg(DISTINCT source_type::text ORDER BY source_type::text) AS sources
       FROM ledger_transactions WHERE tenant_id = $1`,
      [tenant.id],
    );
    const { rows: stock } = await pool.query<{ item_type: string; item_id: string | null; balance: string }>(
      `SELECT item_type::text, item_id::text, sum(quantity)::text AS balance FROM inventory_movements
       WHERE tenant_id = $1 GROUP BY item_type, item_id ORDER BY 1, 2`,
      [tenant.id],
    );

    expect(unbalanced).toEqual([]);
    expect(empty).toEqual([]);
    expect(negative).toEqual([]);
    expect(counts[0]!.sources).toEqual([
      'OPENING_BALANCE',
      'SALES_INVOICE',
      'SALES_INVOICE_AMENDMENT',
      'SECOND_HAND_PURCHASE',
      'SETTLEMENT',
    ]);
    // A فروخته شد، B دست‌نخورده؛ ۱۰ − ۳ + ۱ (اصلاح) = ۸ سکه؛ آبشده = خرید + مرجوعی + تسویه‌ی طلایی.
    const balanceOf = (type: string, id: string | null): string | undefined =>
      stock.find((row) => row.item_type === type && row.item_id === id)?.balance;
    expect(balanceOf('JEWELRY', ids.jewelryA)).toBe('0');
    expect(balanceOf('JEWELRY', ids.jewelryB)).toBe('1');
    expect(balanceOf('COIN', ids.coinTypeId)).toBe('8');
    const melted = stock.filter((row) => row.item_type === 'MELTED_GOLD');
    expect(melted.reduce((total, row) => total + BigInt(row.balance), 0n)).toBe(
      (4000n * BigInt(PURCHASE_KARAT)) / 1000n + (8000n * BigInt(PURCHASE_KARAT)) / 1000n + 3750n,
    );
  });

  it('گزارش تاریخی با ثبت مظنه‌ی تازه تغییر نمی‌کند', async () => {
    const snapshot = async (): Promise<unknown[]> => [
      read(
        await http('GET', `/reporting/profit?from=${encodeURIComponent(scenarioStart)}&to=${encodeURIComponent(profitTo)}`, tokens.owner),
        200,
        profitReportSchema,
      ),
      read(await http('GET', `/sales/invoices/${ids.cashInvoiceId}/detail`, tokens.owner), 200, salesInvoiceDetailSchema),
      read(await http('GET', `/sales/invoices/${ids.coinInvoiceId}/detail`, tokens.owner), 200, salesInvoiceDetailSchema),
      read(
        await http('GET', `/parties/${ids.partyId}/statement?limit=200&to=${encodeURIComponent(profitTo)}`, tokens.owner),
        200,
        partyStatementSchema,
      ),
      read(
        await http('GET', `/reporting/debtors?referenceQuoteId=${ids.quoteId}&displayUnit=RIAL`, tokens.owner),
        200,
        partyBalanceReportSchema,
      ),
      // calculatedAt لحظه‌ی خواندن است؛ بقیه‌ی پاسخ (مانده و معادل طلایی با مظنه‌ی مرجع) باید ثابت بماند.
      (({ calculatedAt: _ignored, ...rest }) => rest)(
        read(
          await http('GET', `/parties/${ids.partyId}/balances?referenceQuoteId=${ids.quoteId}`, tokens.owner),
          200,
          partyBalancesSchema,
        ),
      ),
    ];

    const before = await snapshot();
    const newQuote = read(
      await http('POST', '/pricing/quotes/manual', tokens.owner, { quoteType: 'MAZNEH', amountRial: '135000000' }),
      201,
      priceQuoteSchema,
    );
    const after = await snapshot();

    expect(newQuote.id).not.toBe(ids.quoteId);
    expect(after).toEqual(before);

    // معادل طلایی مانده فقط با مظنه‌ای عوض می‌شود که صریحاً انتخاب شود — نمای جاری، نه بازنویسی تاریخ.
    const withNewQuote = read(
      await http('GET', `/parties/${ids.partyId}/balances?referenceQuoteId=${newQuote.id}`, tokens.owner),
      200,
      partyBalancesSchema,
    );
    expect(withNewQuote.convertedView?.referenceMazneh.id).toBe(newQuote.id);
    expect(withNewQuote.rawBalances).toEqual((before[5] as { rawBalances: unknown }).rawBalances);
    expect(withNewQuote.convertedView).not.toEqual((before[5] as { convertedView: unknown }).convertedView);
  });
});
