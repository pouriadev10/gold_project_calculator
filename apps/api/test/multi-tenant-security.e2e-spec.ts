import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { JewelryItemsService } from '../src/modules/inventory/jewelry-items.service';
import { OpeningBalancesService } from '../src/modules/inventory/opening-balances.service';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { PasswordService } from '../src/platform/auth/password.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import {
  APP_DATABASE_ROLE,
  TENANT_SETTING,
  withTenantTransaction,
} from '../src/platform/database/tenant-transaction';
import { IDEMPOTENCY_KEY_HEADER } from '../src/platform/idempotency/idempotency-key';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import type { Database } from '../src/platform/database/connect';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PoolClient } from 'pg';

const PASSWORD = 'multi-tenant-security-password-1';

type Method = 'GET' | 'POST' | 'PATCH';

type HttpResult = {
  readonly statusCode: number;
  readonly contentType: string;
  readonly text: string;
};

/** هر چیزی که آزمون از یک مستأجر لازم دارد؛ همه از مسیرهای واقعی ساخته می‌شوند. */
type TenantFixture = {
  readonly id: string;
  readonly token: string;
  readonly ownerId: string;
  readonly partyId: string;
  readonly soldItemId: string;
  readonly spareItemId: string;
  readonly quoteId: string;
  readonly invoiceId: string;
  readonly purchaseId: string;
  readonly coinTypeId: string;
  readonly cashAccountId: string;
  readonly goldDimensionId: string;
};

/** شمار ردیف‌های هر جدول دارای `tenant_id` برای یک مستأجر. */
type Footprint = Readonly<Record<string, number>>;

/**
 * امنیت Multi-Tenant — BE-065.
 *
 * مستأجر الف با توکن و نقش OWNER واقعی خودش تلاش می‌کند داده‌ی مستأجر ب را
 * بخواند، ویرایش کند، حذف (غیرفعال) کند، در سند مبدأ خودش به کار ببرد، به
 * Party خودش پیوند دهد، با شناسه حدس بزند و در PDF بگیرد — یک بار از API و یک
 * بار با SQL مستقیم در نقش برنامه (`gold_app`). بعد از هر تلاش ناموفق،
 * ردپای هر دو مستأجر در همه‌ی جدول‌ها باید دست‌نخورده بماند.
 *
 * «پاسخ مناسب» یعنی: داده‌ی مستأجر دیگر برای الف **وجود ندارد** (۴۰۴، دقیقاً
 * همان پاسخ یک UUID تصادفی — بدون oracle وجود)، و توکنِ مستأجر دیگر ۴۰۳ است.
 */
describe('امنیت Multi-Tenant: مستأجر الف به داده‌ی مستأجر ب نمی‌رسد (BE-065)', () => {
  const adapter = new FastifyAdapter();
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://gold:gold@localhost:5432/gold_test',
  });
  const tenantIds: string[] = [];
  let app: NestFastifyApplication;
  let db: Database;
  let a: TenantFixture;
  let b: TenantFixture;
  let tenantTables: readonly string[] = [];

  async function http(
    as: TenantFixture,
    method: Method,
    url: string,
    payload?: object,
    tenantHeader = as.id,
  ): Promise<HttpResult> {
    const response = await adapter.getInstance().inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload }),
      headers: {
        authorization: `Bearer ${as.token}`,
        'x-tenant-id': tenantHeader,
        [IDEMPOTENCY_KEY_HEADER]: randomUUID(),
      },
    });
    return {
      statusCode: response.statusCode,
      contentType: String(response.headers['content-type'] ?? ''),
      text: response.body,
    };
  }

  function json(result: HttpResult): Record<string, unknown> {
    return JSON.parse(result.text) as Record<string, unknown>;
  }

  /** بدنه‌ی خطا بدون شناسه‌ی درخواست و بدون خودِ UUID پرسیده‌شده. */
  function normalizedError(result: HttpResult, probedId: string): string {
    const body = result.text.replace(/"requestId":"[^"]*"/g, '"requestId":"<request>"');
    return `${result.statusCode} ${body.split(probedId).join('<id>')}`;
  }

  async function footprint(tenantId: string): Promise<Footprint> {
    const counts: Record<string, number> = {};
    for (const table of tenantTables) {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
        [tenantId],
      );
      counts[table] = rows[0]!.n;
    }
    return counts;
  }

  async function bothFootprints(): Promise<{ readonly a: Footprint; readonly b: Footprint }> {
    return { a: await footprint(a.id), b: await footprint(b.id) };
  }

  /** SQL مستقیم با نقش برنامه و مستأجر الف؛ همیشه rollback. */
  async function asTenantA<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${APP_DATABASE_ROLE}`);
      await client.query('SELECT set_config($1, $2, true)', [TENANT_SETTING, a.id]);
      return await work(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  /** یک دستور در savepoint خودش، تا خطایش بقیه‌ی تراکنش آزمون را نکشد. */
  async function attempt(client: PoolClient, text: string, params: readonly unknown[] = []) {
    await client.query('SAVEPOINT probe');
    try {
      const result = await client.query(text, [...params]);
      await client.query('RELEASE SAVEPOINT probe');
      return { rowCount: result.rowCount, rows: result.rows as unknown[] };
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT probe');
      throw error;
    }
  }

  async function seedTenant(label: string): Promise<TenantFixture> {
    const tenant = await app.get(TenantService).create({
      name: label,
      slug: `mt-sec-${randomUUID().slice(0, 12)}`,
    });
    tenantIds.push(tenant.id);
    const users = app.get(UserService);
    const owner = await users.create({
      email: `${randomUUID().slice(0, 12)}@example.com`,
      displayName: `${label} owner`,
    });
    await users.setPasswordHash(owner.id, await app.get(PasswordService).hash(PASSWORD));
    await app.get(MembershipService).add(tenant.id, { userId: owner.id, roleCode: 'OWNER' });
    const login = await adapter.getInstance().inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: owner.email, password: PASSWORD, tenantSlug: tenant.slug },
    });
    expect(login.statusCode).toBe(200);
    const token = login.json<{ accessToken: string }>().accessToken;

    const validFrom = new Date(Date.now() - 60_000);
    const createItem = async (suffix: string) =>
      (
        await app.get(JewelryItemsService).createItem({
          tenantId: tenant.id,
          code: `MT-${suffix}-${randomUUID().slice(0, 6)}`,
          title: `انگشتر ${suffix}`,
          grossWeightMg: 8_000n,
          karat: 750,
          stoneWeightMg: 0n,
          otherDeductionWeightMg: 0n,
          wageType: 'PER_GRAM',
          wageValue: 300_000n,
          validFrom,
          active: true,
        })
      ).jewelryItemId;
    const soldItemId = await createItem('SOLD');
    const spareItemId = await createItem('SPARE');
    await withTenantTransaction(db, tenant.id, (transaction) =>
      app.get(OpeningBalancesService).createInTransaction(transaction, {
        tenantId: tenant.id,
        effectiveAt: validFrom,
        description: 'موجودی افتتاحیه‌ی آزمون امنیت',
        createdBy: owner.id,
        lines: [
          { itemType: 'JEWELRY', itemId: soldItemId, quantity: 1n },
          { itemType: 'JEWELRY', itemId: spareItemId, quantity: 1n },
        ],
      }),
    );
    const quoteId = (
      await app.get(PriceQuotesService).createManual({
        tenantId: tenant.id,
        quoteType: 'MAZNEH',
        amountRial: 100_000_000n,
        createdBy: owner.id,
      })
    ).id;

    const partial: TenantFixture = {
      id: tenant.id,
      token,
      ownerId: owner.id,
      partyId: '',
      soldItemId,
      spareItemId,
      quoteId,
      invoiceId: '',
      purchaseId: '',
      coinTypeId: '',
      cashAccountId: '',
      goldDimensionId: '',
    };
    const party = await http(partial, 'POST', '/parties', { type: 'CONSUMER', displayName: `مشتری ${label}` });
    expect(party.statusCode).toBe(201);
    const partyId = String(json(party)['id']);
    const sale = await http(partial, 'POST', '/sales/invoices/jewelry', {
      partyId,
      jewelryItemId: soldItemId,
      quoteId,
      effectiveAt: new Date().toISOString(),
    });
    expect(sale.statusCode).toBe(201);
    const purchase = await http(partial, 'POST', '/purchase/second-hand/gold', {
      partyId,
      grossWeightMg: '5000',
      quoteId,
      effectiveAt: new Date().toISOString(),
    });
    expect(purchase.statusCode).toBe(201);

    const { rows } = await pool.query<{ coinTypeId: string; cashAccountId: string; goldDimensionId: string }>(
      `SELECT (SELECT id FROM coin_types WHERE tenant_id = $1 ORDER BY code LIMIT 1) AS "coinTypeId",
              (SELECT id FROM ledger_accounts WHERE tenant_id = $1 AND system_key = 'CASH') AS "cashAccountId",
              (SELECT id FROM asset_dimensions WHERE tenant_id = $1 AND code = 'GOLD') AS "goldDimensionId"`,
      [tenant.id],
    );

    return {
      ...partial,
      partyId,
      invoiceId: String(json(sale)['invoiceId']),
      purchaseId: String(json(purchase)['secondHandPurchaseId']),
      coinTypeId: rows[0]!.coinTypeId,
      cashAccountId: rows[0]!.cashAccountId,
      goldDimensionId: rows[0]!.goldDimensionId,
    };
  }

  /** هر شناسه‌ای از مستأجر ب که نباید هرگز در پاسخی به الف دیده شود. */
  function bIds(): readonly string[] {
    return [b.id, b.partyId, b.soldItemId, b.spareItemId, b.quoteId, b.invoiceId, b.purchaseId, b.coinTypeId];
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();
    db = app.get<Database>(DRIZZLE);

    a = await seedTenant('مستأجر الف');
    b = await seedTenant('مستأجر ب');
    tenantTables = (
      await pool.query<{ table_name: string }>(
        `SELECT c.table_name FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
         ORDER BY c.table_name`,
      )
    ).rows.map((row) => row.table_name);
  });

  afterAll(async () => {
    for (const tenantId of tenantIds) {
      await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    }
    await app.close();
    await pool.end();
  });

  describe('API', () => {
    it('توکن مستأجر الف با هدر مستأجر ب برای خواندن و نوشتن ۴۰۳ می‌گیرد', async () => {
      const before = await bothFootprints();
      const reads = [
        '/parties',
        `/parties/${b.partyId}`,
        '/sales/invoices',
        `/sales/invoices/${b.invoiceId}/detail`,
        `/sales/invoices/${b.invoiceId}/pdf`,
        '/inventory/jewelry-items',
        '/inventory/balances',
        '/pricing/quotes',
        '/reporting/dashboard',
        '/transactions/recent',
        '/settings/general',
      ];
      for (const url of reads) {
        const result = await http(a, 'GET', url, undefined, b.id);
        expect({ url, status: result.statusCode }).toEqual({ url, status: 403 });
        for (const id of bIds()) expect(result.text).not.toContain(id);
      }
      const write = await http(a, 'POST', '/parties', { type: 'CONSUMER', displayName: 'نفوذی' }, b.id);
      expect(write.statusCode).toBe(403);
      expect(await bothFootprints()).toEqual(before);
    });

    it('خواندن با شناسه‌ی مستأجر ب: ۴۰۴، دقیقاً مثل یک شناسه‌ی تصادفی (بدون oracle وجود)', async () => {
      const probes: ReadonlyArray<readonly [string, (id: string) => string]> = [
        [b.partyId, (id) => `/parties/${id}`],
        [b.partyId, (id) => `/parties/${id}/balances`],
        [b.partyId, (id) => `/parties/${id}/statement`],
        [b.soldItemId, (id) => `/inventory/jewelry-items/${id}`],
        [b.invoiceId, (id) => `/sales/invoices/${id}/detail`],
        [b.invoiceId, (id) => `/sales/invoices/${id}/versions`],
        [b.invoiceId, (id) => `/sales/invoices/${id}/amendments`],
        [b.invoiceId, (id) => `/sales/invoices/${id}/amendment-policy`],
        // مظنه‌ی ب به‌عنوان نرخ مرجع گزارش الف هم «وجود ندارد».
        [b.quoteId, (id) => `/reporting/debtors?referenceQuoteId=${id}`],
        [b.quoteId, (id) => `/parties/${a.partyId}/balances?referenceQuoteId=${id}`],
      ];
      for (const [foreignId, url] of probes) {
        const random = randomUUID();
        const foreign = await http(a, 'GET', url(foreignId));
        const unknown = await http(a, 'GET', url(random));

        expect({ url: url('<id>'), status: foreign.statusCode }).toEqual({ url: url('<id>'), status: 404 });
        expect(normalizedError(foreign, foreignId)).toBe(normalizedError(unknown, random));
      }
    });

    it('هیچ فهرستی داده‌ی مستأجر ب را نشان نمی‌دهد (ولی داده‌ی خود الف را نشان می‌دهد)', async () => {
      const lists = [
        '/parties',
        '/sales/invoices',
        '/inventory/jewelry-items',
        '/inventory/balances',
        '/inventory/coin-types',
        '/inventory/coin-types/history',
        '/inventory/movements/recent',
        '/pricing/quotes',
        '/pricing/quotes/latest',
        '/transactions/recent',
        '/reporting/dashboard',
        `/reporting/debtors?referenceQuoteId=${a.quoteId}`,
        `/reporting/creditors?referenceQuoteId=${a.quoteId}`,
      ];
      const offenders: string[] = [];
      for (const url of lists) {
        const result = await http(a, 'GET', url);
        if (result.statusCode !== 200) offenders.push(`${url}: ${result.statusCode} ${result.text.slice(0, 200)}`);
        if (bIds().some((id) => result.text.includes(id))) offenders.push(`${url}: leaks an id of B`);
      }
      expect(offenders).toEqual([]);
      expect((await http(a, 'GET', '/parties')).text).toContain(a.partyId);
      expect((await http(a, 'GET', '/sales/invoices')).text).toContain(a.invoiceId);
      expect((await http(a, 'GET', '/inventory/coin-types')).text).toContain(a.coinTypeId);
    });

    it('ویرایش و غیرفعال‌سازی (حذف) داده‌ی مستأجر ب: ۴۰۴ و ب دست‌نخورده', async () => {
      const before = await bothFootprints();
      const attempts: ReadonlyArray<readonly [Method, string, object]> = [
        ['PATCH', `/parties/${b.partyId}`, { displayName: 'بازنویسی' }],
        ['PATCH', `/inventory/jewelry-items/${b.spareItemId}`, { title: 'بازنویسی' }],
        [
          'POST',
          `/inventory/coin-types/${b.coinTypeId}/versions`,
          { title: 'بازنویسی', mintType: 'CENTRAL_BANK', grossWeightUg: '8133000', karat: 900, active: true },
        ],
        ['POST', `/parties/${b.partyId}/deactivate`, {}],
        ['POST', `/inventory/jewelry-items/${b.spareItemId}/deactivate`, {}],
      ];
      for (const [method, url, payload] of attempts) {
        const result = await http(a, method, url, payload);
        expect({ url, status: result.statusCode }).toEqual({ url, status: 404 });
      }

      expect(await bothFootprints()).toEqual(before);
      const { rows } = await pool.query<{ displayName: string; status: string; activeVersions: number }>(
        `SELECT p.display_name AS "displayName", p.status,
                (SELECT count(*)::int FROM jewelry_item_versions v
                 WHERE v.jewelry_item_id = $2 AND v.active AND v.valid_to IS NULL) AS "activeVersions"
         FROM parties p WHERE p.id = $1`,
        [b.partyId, b.spareItemId],
      );
      expect(rows[0]).toEqual({ displayName: 'مشتری مستأجر ب', status: 'ACTIVE', activeVersions: 1 });
    });

    it('استفاده از شناسه‌ی ب در سند مبدأ الف: ۴xx مثل شناسه‌ی تصادفی، بی‌هیچ ردی در دو مستأجر', async () => {
      const before = await bothFootprints();
      const now = new Date().toISOString();
      const sale = (overrides: object) => ({
        partyId: a.partyId,
        jewelryItemId: a.spareItemId,
        quoteId: a.quoteId,
        effectiveAt: now,
        ...overrides,
      });
      /*
       * هر تلاش یک بار با شناسه‌ی واقعی ب و یک بار با UUID تصادفی در همان جا
       * اجرا می‌شود. هر دو باید ۴xx و پاسخشان (بعد از کنار گذاشتن خودِ
       * شناسه) یکی باشد؛ وگرنه پاسخ نشان می‌دهد شناسه‌ی ب جایی وجود دارد.
       */
      type Attempt = readonly [string, string, (id: string) => { readonly url: string; readonly payload: object }];
      const attempts: readonly Attempt[] = [
        ['sale with B party', b.partyId, (id) => ({ url: '/sales/invoices/jewelry', payload: sale({ partyId: id }) })],
        [
          'sale with B item',
          b.spareItemId,
          (id) => ({ url: '/sales/invoices/jewelry', payload: sale({ jewelryItemId: id }) }),
        ],
        ['sale with B quote', b.quoteId, (id) => ({ url: '/sales/invoices/jewelry', payload: sale({ quoteId: id }) })],
        [
          'credit sale with B party',
          b.partyId,
          (id) => ({ url: '/sales/invoices/jewelry/credit', payload: sale({ partyId: id, paidRial: '0' }) }),
        ],
        [
          'coin sale with B coin type',
          b.coinTypeId,
          (id) => ({
            url: '/sales/invoices/coins',
            payload: {
              partyId: a.partyId,
              coinTypeId: id,
              count: 1,
              marketUnitPriceRial: '900000000',
              quoteId: a.quoteId,
              effectiveAt: now,
              paidRial: '0',
            },
          }),
        ],
        [
          'gold purchase from B party',
          b.partyId,
          (id) => ({
            url: '/purchase/second-hand/gold',
            payload: { partyId: id, grossWeightMg: '1000', quoteId: a.quoteId, effectiveAt: now },
          }),
        ],
        [
          'gold purchase with B quote',
          b.quoteId,
          (id) => ({
            url: '/purchase/second-hand/gold',
            payload: { partyId: a.partyId, grossWeightMg: '1000', quoteId: id, effectiveAt: now },
          }),
        ],
        [
          'coin purchase of B coin type',
          b.coinTypeId,
          (id) => ({
            url: '/purchase/second-hand/coins',
            payload: {
              partyId: a.partyId,
              coinTypeId: id,
              count: 1,
              purchaseUnitPriceRial: '900000000',
              quoteId: a.quoteId,
              effectiveAt: now,
            },
          }),
        ],
        [
          'rial settlement on B party',
          b.partyId,
          (id) => ({ url: `/parties/${id}/settlements/rial`, payload: { amountRial: '1000', effectiveAt: now } }),
        ],
        [
          'mixed settlement on B party',
          b.partyId,
          (id) => ({
            url: `/parties/${id}/settlements/mixed`,
            payload: { lines: [{ type: 'RIAL', amountRial: '1000' }], effectiveAt: now },
          }),
        ],
        [
          'mixed settlement of A with B quote',
          b.quoteId,
          (id) => ({
            url: `/parties/${a.partyId}/settlements/mixed`,
            payload: { lines: [{ type: 'GOLD', grossWeightMg: '1000', karat: 750, quoteId: id }], effectiveAt: now },
          }),
        ],
        [
          'opening balance of B item',
          b.spareItemId,
          (id) => ({
            url: '/inventory/opening-balances',
            payload: {
              effectiveAt: now,
              description: 'نفوذی',
              lines: [{ itemType: 'JEWELRY', itemId: id, quantity: '1' }],
            },
          }),
        ],
        [
          'amend B invoice',
          b.invoiceId,
          (id) => ({
            url: `/sales/invoices/${id}/amend`,
            payload: {
              reason: 'WEIGHT_ERROR',
              partyId: a.partyId,
              item: { itemType: 'JEWELRY', jewelryItemId: a.spareItemId, paidRial: '0' },
            },
          }),
        ],
        [
          'buyback of B invoice',
          b.invoiceId,
          (id) => ({
            url: `/sales/invoices/${id}/b2c-buyback`,
            payload: { grossWeightMg: '1000', quoteId: a.quoteId, effectiveAt: now },
          }),
        ],
        [
          'buyback preview of B invoice',
          b.invoiceId,
          (id) => ({
            url: `/sales/invoices/${id}/b2c-buyback/preview`,
            payload: { grossWeightMg: '1000', quoteId: a.quoteId, effectiveAt: now },
          }),
        ],
      ];
      const offenders: string[] = [];
      for (const [name, foreignId, build] of attempts) {
        const random = randomUUID();
        const foreignRequest = build(foreignId);
        const randomRequest = build(random);
        const foreign = await http(a, 'POST', foreignRequest.url, foreignRequest.payload);
        const unknown = await http(a, 'POST', randomRequest.url, randomRequest.payload);
        if (foreign.statusCode < 400 || foreign.statusCode >= 500) offenders.push(`${name}: ${foreign.statusCode}`);
        if (normalizedError(foreign, foreignId) !== normalizedError(unknown, random)) {
          offenders.push(`${name}: differs from a random id`);
        }
      }
      expect(offenders).toEqual([]);
      expect(await bothFootprints()).toEqual(before);
    });

    it('پیوند به Party خودش: نه مستأجر ب، نه Party ب', async () => {
      const before = await bothFootprints();

      const created = await http(a, 'POST', '/parties', {
        type: 'BUSINESS',
        displayName: 'همکار ادعایی',
        linkedTenantId: b.id,
      });
      expect(created.statusCode).toBe(400);
      const patched = await http(a, 'PATCH', `/parties/${a.partyId}`, { linkedTenantId: b.id });
      expect(patched.statusCode).toBe(400);
      const partyError = await http(a, 'POST', `/sales/invoices/${a.invoiceId}/amend`, {
        reason: 'PARTY_ERROR',
        partyId: b.partyId,
        item: { itemType: 'JEWELRY', jewelryItemId: a.soldItemId, paidRial: '0' },
      });
      expect(partyError.statusCode).toBeGreaterThanOrEqual(400);
      expect(partyError.statusCode).toBeLessThan(500);
      expect(await bothFootprints()).toEqual(before);

      // پاک کردن پیوند همچنان مجاز است و پیوندی برجا نمی‌ماند.
      const cleared = await http(a, 'PATCH', `/parties/${a.partyId}`, { linkedTenantId: null });
      expect(cleared.statusCode).toBe(200);
      expect(json(cleared)['linkedTenantId']).toBeNull();
    });

    it('PDF سند مستأجر ب: ۴۰۴ بدون یک بایت PDF، مثل شناسه‌ی تصادفی؛ PDF خود الف سالم است', async () => {
      const pdfs: ReadonlyArray<readonly [string, (id: string) => string]> = [
        [b.invoiceId, (id) => `/sales/invoices/${id}/pdf`],
        [b.purchaseId, (id) => `/purchase/second-hand/${id}/pdf`],
        [b.partyId, (id) => `/parties/${id}/statement/pdf`],
      ];
      for (const [foreignId, url] of pdfs) {
        const random = randomUUID();
        const foreign = await http(a, 'GET', url(foreignId));
        const unknown = await http(a, 'GET', url(random));

        expect({ url: url('<id>'), status: foreign.statusCode }).toEqual({ url: url('<id>'), status: 404 });
        expect(foreign.contentType).not.toContain('pdf');
        expect(foreign.text.startsWith('%PDF')).toBe(false);
        expect(normalizedError(foreign, foreignId)).toBe(normalizedError(unknown, random));
      }

      const own = await http(a, 'GET', `/sales/invoices/${a.invoiceId}/pdf`);
      expect(own.statusCode).toBe(200);
      expect(own.text.startsWith('%PDF')).toBe(true);
    });
  });

  describe('SQL مستقیم با نقش برنامه', () => {
    it('هر جدول دارای tenant_id زیر RLS اجباری با سیاست است (جز refresh_tokens، که نقش برنامه به آن دسترسی ندارد)', async () => {
      const { rows } = await pool.query<{ table: string; enabled: boolean; forced: boolean; policies: number }>(
        `SELECT c.relname AS "table", c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
                (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
        [tenantTables],
      );
      const unprotected = rows
        .filter((row) => !(row.enabled && row.forced && row.policies > 0))
        .map((row) => row.table);

      expect(tenantTables.length).toBeGreaterThan(20);
      expect(unprotected).toEqual(['refresh_tokens']);
    });

    it('نقش برنامه به جدول‌های سراسری فقط همان حداقل لازم را دارد', async () => {
      const { rows } = await pool.query<{ grant: string }>(
        `SELECT table_name || ':' || privilege_type AS grant
         FROM information_schema.role_table_grants
         WHERE grantee = 'gold_app' AND table_schema = 'public'
           AND table_name IN ('tenants', 'users', 'refresh_tokens', 'roles', 'migration_probes')
         ORDER BY 1`,
      );
      const columns = await pool.query<{ grant: string }>(
        `SELECT table_name || '.' || column_name || ':' || privilege_type AS grant
         FROM information_schema.column_privileges
         WHERE grantee = 'gold_app' AND table_schema = 'public' AND table_name = 'users'
         ORDER BY 1`,
      );

      expect(rows.map((row) => row.grant)).toEqual(['roles:SELECT']);
      expect(columns.rows.map((row) => row.grant)).toEqual(['users.display_name:SELECT', 'users.id:SELECT']);
    });

    it('با مستأجر الف، ردیف ب در هیچ جدولی خوانده، ویرایش یا حذف نمی‌شود', async () => {
      const bTotals = await footprint(b.id);
      expect(bTotals['parties']).toBeGreaterThan(0);
      expect(bTotals['sales_invoices']).toBeGreaterThan(0);
      expect(bTotals['ledger_entries']).toBeGreaterThan(0);

      await asTenantA(async (client) => {
        for (const table of tenantTables.filter((name) => name !== 'refresh_tokens')) {
          const read = await attempt(client, `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [b.id]);
          const updated = await attempt(client, `UPDATE ${table} SET tenant_id = tenant_id WHERE tenant_id = $1`, [b.id]);
          const deleted = await attempt(client, `DELETE FROM ${table} WHERE tenant_id = $1`, [b.id]);

          expect({ table, read: read.rows[0], updated: updated.rowCount, deleted: deleted.rowCount }).toEqual({
            table,
            read: { n: 0 },
            updated: 0,
            deleted: 0,
          });
        }
      });
      expect(await footprint(b.id)).toEqual(bTotals);
    });

    it('با مستأجر الف، ردیف به نام ب درج یا به ب منتقل نمی‌شود', async () => {
      await asTenantA(async (client) => {
        await expect(
          attempt(
            client,
            `INSERT INTO parties (tenant_id, type, display_name, normalized_name)
             VALUES ($1, 'CONSUMER', 'جعلی', 'جعلی')`,
            [b.id],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          attempt(
            client,
            `INSERT INTO price_quotes (tenant_id, quote_type, amount_rial, source) VALUES ($1, 'MAZNEH', 1, 'MANUAL')`,
            [b.id],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          attempt(client, 'UPDATE parties SET tenant_id = $1 WHERE id = $2', [b.id, a.partyId]),
        ).rejects.toMatchObject({ code: '42501' });
      });
    });

    it('سند الف نمی‌تواند به Party، حساب یا کالای ب ارجاع دهد', async () => {
      await asTenantA(async (client) => {
        await expect(
          attempt(client, `INSERT INTO sales_invoices (tenant_id, status, party_id) VALUES ($1, 'DRAFT', $2)`, [
            a.id,
            b.partyId,
          ]),
        ).rejects.toMatchObject({ code: '23503', constraint: 'sales_invoices_tenant_party_fk' });
        await expect(
          attempt(
            client,
            `INSERT INTO second_hand_purchases (tenant_id, party_id, locked_quote_id, locked_quote_amount_rial,
                                                locked_quote_observed_at, settings_snapshot, seller_identity_snapshot,
                                                fee_rial, final_amount_rial, effective_at, finalized_at)
             VALUES ($1, $2, $3, 1, now(), '{}', '{}', 0, 1, now(), now())`,
            [a.id, a.partyId, b.quoteId],
          ),
        ).rejects.toMatchObject({ code: '23503', constraint: 'second_hand_purchases_tenant_quote_fk' });
        await expect(
          attempt(
            client,
            `INSERT INTO ledger_entries (tenant_id, transaction_id, account_id, dimension_id, quantity)
             SELECT tenant_id, transaction_id, $2, dimension_id, 1 FROM ledger_entries WHERE tenant_id = $1 LIMIT 1`,
            [a.id, b.cashAccountId],
          ),
        ).rejects.toMatchObject({ code: '23503', constraint: 'ledger_entries_tenant_account_fk' });
        // کلیدهای خارجی کالا از BE-063 تا COMMIT صبر می‌کنند؛ این تراکنش آزمون commit نمی‌شود.
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
        await expect(
          attempt(
            client,
            `INSERT INTO inventory_movements (tenant_id, source_type, source_id, item_type, item_id, dimension_id, quantity, occurred_at)
             VALUES ($1, 'CORRECTION', $2, 'JEWELRY', $3, $4, 1, now())`,
            [a.id, randomUUID(), b.spareItemId, a.goldDimensionId],
          ),
        ).rejects.toMatchObject({ code: '23503' });
      });
    });

    it('داده‌ی سراسری مستأجر ب (کاربر، توکن، خود مستأجر) با نقش برنامه دست‌نیافتنی است', async () => {
      await asTenantA(async (client) => {
        await expect(
          attempt(client, 'SELECT password_hash FROM users WHERE id = $1', [b.ownerId]),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          attempt(client, 'SELECT token_hash FROM refresh_tokens WHERE tenant_id = $1', [b.id]),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          attempt(client, `UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [b.id]),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(attempt(client, 'SELECT id FROM tenants')).rejects.toMatchObject({ code: '42501' });
        // تنها ستون‌های لازم برای نام سازنده‌ی سند باز است.
        await expect(attempt(client, 'SELECT id, display_name FROM users LIMIT 1')).resolves.toBeDefined();
      });
    });

    it('بدون تنظیم مستأجر، نقش برنامه هیچ ردیف مستأجری نمی‌بیند (خرابی بسته)', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL ROLE ${APP_DATABASE_ROLE}`);
        for (const table of ['parties', 'sales_invoices', 'ledger_entries', 'inventory_movements']) {
          const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
          expect({ table, n: rows[0]!.n }).toEqual({ table, n: 0 });
        }
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });
});
