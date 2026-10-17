import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { InventoryMovementsService } from '../src/modules/inventory/inventory-movements.service';
import { JewelryItemsService } from '../src/modules/inventory/jewelry-items.service';
import { OpeningBalancesService } from '../src/modules/inventory/opening-balances.service';
import { LedgerPostingService } from '../src/modules/ledger/ledger-posting.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { DocumentCountersService } from '../src/modules/sales/document-counters.service';
import { PasswordService } from '../src/platform/auth/password.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import { ledgerEntries } from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { IDEMPOTENCY_KEY_HEADER } from '../src/platform/idempotency/idempotency-key';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import type { Database } from '../src/platform/database/connect';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const PASSWORD = 'atomic-transactions-password-1';

/** مرحله‌هایی که شکست تزریقی‌شان واقعاً اجرا شد؛ هر آزمون باید خالی‌اش کند. */
const fired: string[] = [];

/**
 * خطای تزریقی؛ فقط بعد از اجرای موفق مرحله‌ی واقعی ساخته می‌شود. ثبتش در
 * `fired` جلوی مثبت کاذب را می‌گیرد: ۵۰۰ِ یک خطای دیگر جای تزریق را نمی‌گیرد.
 */
class InjectedFailure extends Error {
  constructor(step: string) {
    super(`injected failure: ${step}`);
    this.name = 'InjectedFailure';
    fired.push(step);
  }
}

function expectInjected(result: { readonly statusCode: number }, step: string): void {
  expect(result.statusCode).toBe(500);
  expect(fired.splice(0)).toEqual([step]);
}

type HttpResult = {
  readonly statusCode: number;
  readonly body: Record<string, unknown>;
};

/** شمارش همه‌ی جدول‌هایی که یک عملیات مالی ممکن است در آن‌ها ردی بگذارد. */
type Footprint = {
  readonly sales_invoices: number;
  readonly sales_invoice_versions: number;
  readonly sales_invoice_items: number;
  readonly invoice_counter: number;
  readonly ledger_transactions: number;
  readonly ledger_entries: number;
  readonly inventory_movements: number;
  readonly second_hand_purchases: number;
  readonly second_hand_purchase_items: number;
  readonly settlements: number;
  readonly settlement_lines: number;
  readonly idempotency_records: number;
  readonly audit_logs: number;
};

/**
 * تراکنش اتمیک End-to-End — BE-064.
 *
 * هر سناریو از مسیر HTTP واقعی (auth → idempotency → service → PostgreSQL)
 * می‌گذرد. شکست‌ها با `vi.spyOn` روی همان singletonهایی تزریق می‌شوند که
 * همه‌ی جریان‌ها از آن‌ها رد می‌شوند؛ هر تزریق اول مرحله‌ی واقعی را اجرا
 * می‌کند و بعد می‌ترکد، پس ردیف‌ها واقعاً نوشته شده‌اند و rollback است که
 * باید پاکشان کند — نه اینکه اصلاً نوشته نشده باشند.
 *
 * بعد از هر آزمون `violations()` با نقش superuser (بدون RLS) دنبال هر ردّ
 * نیمه‌کاره می‌گردد: معیارهای «تمام است وقتی» تسک به‌اضافه‌ی پیش‌نویس جامانده،
 * claim معلق idempotency و شکاف شماره‌ی فاکتور.
 */
describe('تراکنش اتمیک End-to-End (BE-064)', () => {
  const adapter = new FastifyAdapter();
  const tenant = { id: '', slug: `atomic-${randomUUID().slice(0, 12)}` };
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://gold:gold@localhost:5432/gold_test',
  });
  let app: NestFastifyApplication;
  let db: Database;
  let ledger: LedgerPostingService;
  let movements: InventoryMovementsService;
  let counters: DocumentCountersService;
  let token = '';
  let partyId = '';
  let quoteId = '';
  const items: Record<string, string> = {};

  async function http(url: string, payload: object, key: string): Promise<HttpResult> {
    const response = await adapter.getInstance().inject({
      method: 'POST',
      url,
      payload,
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': tenant.id,
        [IDEMPOTENCY_KEY_HEADER]: key,
      },
    });
    return { statusCode: response.statusCode, body: response.json<Record<string, unknown>>() };
  }

  /** `effectiveAt` بخشی از بدنه است؛ تکرار idempotent باید همان مقدار را بفرستد. */
  function cashSale(itemKey: string, key = randomUUID(), effectiveAt = new Date()): Promise<HttpResult> {
    return http(
      '/sales/invoices/jewelry',
      { partyId, jewelryItemId: items[itemKey], quoteId, effectiveAt: effectiveAt.toISOString() },
      key,
    );
  }

  async function footprint(): Promise<Footprint> {
    const { rows } = await pool.query<Footprint>(
      `SELECT
         (SELECT count(*)::int FROM sales_invoices WHERE tenant_id = $1) AS sales_invoices,
         (SELECT count(*)::int FROM sales_invoice_versions WHERE tenant_id = $1) AS sales_invoice_versions,
         (SELECT count(*)::int FROM sales_invoice_items WHERE tenant_id = $1) AS sales_invoice_items,
         (SELECT coalesce(sum(current_value), 0)::int FROM document_counters WHERE tenant_id = $1) AS invoice_counter,
         (SELECT count(*)::int FROM ledger_transactions WHERE tenant_id = $1) AS ledger_transactions,
         (SELECT count(*)::int FROM ledger_entries WHERE tenant_id = $1) AS ledger_entries,
         (SELECT count(*)::int FROM inventory_movements WHERE tenant_id = $1) AS inventory_movements,
         (SELECT count(*)::int FROM second_hand_purchases WHERE tenant_id = $1) AS second_hand_purchases,
         (SELECT count(*)::int FROM second_hand_purchase_items WHERE tenant_id = $1) AS second_hand_purchase_items,
         (SELECT count(*)::int FROM settlements WHERE tenant_id = $1) AS settlements,
         (SELECT count(*)::int FROM settlement_lines WHERE tenant_id = $1) AS settlement_lines,
         (SELECT count(*)::int FROM idempotency_records WHERE tenant_id = $1) AS idempotency_records,
         (SELECT count(*)::int FROM audit_logs WHERE tenant_id = $1) AS audit_logs`,
      [tenant.id],
    );
    return rows[0]!;
  }

  /** هر ردیفی که نشان‌دهنده‌ی عملیات نیمه‌کاره است؛ انتظار همیشه فهرست خالی است. */
  async function violations(tenantId = tenant.id): Promise<string[]> {
    const { rows } = await pool.query<{ violation: string; ref: string }>(
      `WITH counter AS (
         SELECT coalesce(sum(current_value), 0)::int AS value
         FROM document_counters WHERE tenant_id = $1 AND document_type = 'SALES_INVOICE'
       )
       SELECT 'finalized invoice without ledger' AS violation, si.id::text AS ref
       FROM sales_invoices si
       WHERE si.tenant_id = $1 AND si.status = 'FINALIZED'
         AND NOT EXISTS (SELECT 1 FROM ledger_transactions lt
                         WHERE lt.tenant_id = si.tenant_id AND lt.source_type = 'SALES_INVOICE' AND lt.source_id = si.id)
       UNION ALL
       SELECT 'finalized invoice without inventory movement', si.id::text
       FROM sales_invoices si
       WHERE si.tenant_id = $1 AND si.status = 'FINALIZED'
         AND NOT EXISTS (SELECT 1 FROM inventory_movements m
                         WHERE m.tenant_id = si.tenant_id AND m.source_type = 'SALE' AND m.source_id = si.id)
       UNION ALL
       SELECT 'draft invoice left behind', si.id::text
       FROM sales_invoices si WHERE si.tenant_id = $1 AND si.status = 'DRAFT'
       UNION ALL
       SELECT 'invoice version beyond current version', v.id::text
       FROM sales_invoice_versions v
       JOIN sales_invoices si ON si.tenant_id = v.tenant_id AND si.id = v.sales_invoice_id
       WHERE v.tenant_id = $1 AND v.version > si.current_version
       UNION ALL
       SELECT 'amendment without ledger', v.id::text
       FROM sales_invoice_versions v
       WHERE v.tenant_id = $1 AND v.version > 1
         AND NOT EXISTS (SELECT 1 FROM ledger_transactions lt
                         WHERE lt.tenant_id = v.tenant_id AND lt.source_type = 'SALES_INVOICE_AMENDMENT' AND lt.source_id = v.id)
       UNION ALL
       SELECT 'ledger without source document', lt.id::text
       FROM ledger_transactions lt
       WHERE lt.tenant_id = $1 AND NOT (CASE lt.source_type
         WHEN 'SALES_INVOICE' THEN EXISTS (SELECT 1 FROM sales_invoices s
           WHERE s.tenant_id = lt.tenant_id AND s.id = lt.source_id AND s.status = 'FINALIZED')
         WHEN 'SALES_INVOICE_AMENDMENT' THEN EXISTS (SELECT 1 FROM sales_invoice_versions v
           WHERE v.tenant_id = lt.tenant_id AND v.id = lt.source_id AND v.version > 1)
         WHEN 'SECOND_HAND_PURCHASE' THEN EXISTS (SELECT 1 FROM second_hand_purchases p
           WHERE p.tenant_id = lt.tenant_id AND p.id = lt.source_id)
         WHEN 'SETTLEMENT' THEN EXISTS (SELECT 1 FROM settlements s
           WHERE s.tenant_id = lt.tenant_id AND s.id = lt.source_id AND s.status = 'FINALIZED')
         WHEN 'OPENING_BALANCE' THEN EXISTS (SELECT 1 FROM opening_balances o
           WHERE o.tenant_id = lt.tenant_id AND o.id = lt.source_id)
         WHEN 'LEDGER_REVERSAL' THEN EXISTS (SELECT 1 FROM ledger_transactions o
           WHERE o.tenant_id = lt.tenant_id AND o.id = lt.source_id)
         ELSE false END)
       UNION ALL
       SELECT 'ledger transaction without entries', lt.id::text
       FROM ledger_transactions lt
       WHERE lt.tenant_id = $1
         AND NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.tenant_id = lt.tenant_id AND e.transaction_id = lt.id)
       UNION ALL
       SELECT 'inventory without valid source', m.id::text
       FROM inventory_movements m
       WHERE m.tenant_id = $1 AND NOT (CASE m.source_type
         WHEN 'SALE' THEN EXISTS (SELECT 1 FROM sales_invoices s
           WHERE s.tenant_id = m.tenant_id AND s.id = m.source_id AND s.status = 'FINALIZED')
         WHEN 'CORRECTION' THEN EXISTS (SELECT 1 FROM sales_invoice_versions v
           WHERE v.tenant_id = m.tenant_id AND v.id = m.source_id AND v.version > 1)
         WHEN 'SECOND_HAND_PURCHASE' THEN EXISTS (SELECT 1 FROM second_hand_purchases p
           WHERE p.tenant_id = m.tenant_id AND p.id = m.source_id)
         WHEN 'SETTLEMENT' THEN EXISTS (SELECT 1 FROM settlements s
           WHERE s.tenant_id = m.tenant_id AND s.id = m.source_id AND s.status = 'FINALIZED')
         WHEN 'OPENING_BALANCE' THEN EXISTS (SELECT 1 FROM opening_balances o
           WHERE o.tenant_id = m.tenant_id AND o.id = m.source_id)
         ELSE false END)
       UNION ALL
       SELECT 'second-hand purchase without ledger, inventory or items', p.id::text
       FROM second_hand_purchases p
       WHERE p.tenant_id = $1 AND (
         NOT EXISTS (SELECT 1 FROM ledger_transactions lt
                     WHERE lt.tenant_id = p.tenant_id AND lt.source_type = 'SECOND_HAND_PURCHASE' AND lt.source_id = p.id)
         OR NOT EXISTS (SELECT 1 FROM inventory_movements m
                        WHERE m.tenant_id = p.tenant_id AND m.source_type = 'SECOND_HAND_PURCHASE' AND m.source_id = p.id)
         OR NOT EXISTS (SELECT 1 FROM second_hand_purchase_items i
                        WHERE i.tenant_id = p.tenant_id AND i.second_hand_purchase_id = p.id))
       UNION ALL
       SELECT 'settlement not finalized or without ledger or lines', s.id::text
       FROM settlements s
       WHERE s.tenant_id = $1 AND (
         s.status <> 'FINALIZED'
         OR NOT EXISTS (SELECT 1 FROM ledger_transactions lt
                        WHERE lt.tenant_id = s.tenant_id AND lt.source_type = 'SETTLEMENT' AND lt.source_id = s.id)
         OR NOT EXISTS (SELECT 1 FROM settlement_lines l WHERE l.tenant_id = s.tenant_id AND l.settlement_id = s.id))
       UNION ALL
       SELECT 'pending idempotency claim', r.key
       FROM idempotency_records r WHERE r.tenant_id = $1 AND r.status <> 'COMPLETED'
       UNION ALL
       SELECT 'invoice number gap', n::text
       FROM counter, generate_series(1, counter.value) AS n
       WHERE NOT EXISTS (SELECT 1 FROM sales_invoices s WHERE s.tenant_id = $1 AND s.invoice_number = n)
       UNION ALL
       SELECT 'invoice number beyond counter', s.invoice_number::text
       FROM sales_invoices s, counter
       WHERE s.tenant_id = $1 AND s.invoice_number > counter.value`,
      [tenantId],
    );
    return rows.map((row) => `${row.violation}: ${row.ref}`);
  }

  async function invoiceNumbers(): Promise<number[]> {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT invoice_number AS n FROM sales_invoices
       WHERE tenant_id = $1 AND invoice_number IS NOT NULL ORDER BY invoice_number`,
      [tenant.id],
    );
    return rows.map((row) => row.n);
  }

  async function stock(itemKey: string): Promise<bigint> {
    return movements.balance(tenant.id, 'JEWELRY', items[itemKey]!);
  }

  /** مرحله‌ی واقعی دفتر کل اجرا می‌شود — ردیف‌ها نوشته می‌شوند — و بعد شکست. */
  function failLedgerAfterWrite(): void {
    const real = ledger.postInTransaction.bind(ledger);
    vi.spyOn(ledger, 'postInTransaction').mockImplementationOnce(async (transaction, input) => {
      await real(transaction, input);
      throw new InjectedFailure('ledger posting');
    });
  }

  function failInventoryAfterWrite(method: 'recordInTransaction' | 'recordManyInTransaction'): void {
    if (method === 'recordInTransaction') {
      const real = movements.recordInTransaction.bind(movements);
      vi.spyOn(movements, 'recordInTransaction').mockImplementationOnce(async (...args) => {
        await real(...args);
        throw new InjectedFailure('inventory movement');
      });
      return;
    }
    const real = movements.recordManyInTransaction.bind(movements);
    vi.spyOn(movements, 'recordManyInTransaction').mockImplementationOnce(async (...args) => {
      await real(...args);
      throw new InjectedFailure('inventory movements');
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();

    db = app.get<Database>(DRIZZLE);
    ledger = app.get(LedgerPostingService);
    movements = app.get(InventoryMovementsService);
    counters = app.get(DocumentCountersService);
    const users = app.get(UserService);
    const passwords = app.get(PasswordService);
    const memberships = app.get(MembershipService);
    const jewelry = app.get(JewelryItemsService);
    const opening = app.get(OpeningBalancesService);

    tenant.id = (await app.get(TenantService).create({ name: 'Atomic transactions', slug: tenant.slug })).id;
    const owner = await users.create({
      email: `${randomUUID().slice(0, 12)}@example.com`,
      displayName: 'Atomic owner',
    });
    await users.setPasswordHash(owner.id, await passwords.hash(PASSWORD));
    await memberships.add(tenant.id, { userId: owner.id, roleCode: 'OWNER' });
    const login = await adapter.getInstance().inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: owner.email, password: PASSWORD, tenantSlug: tenant.slug },
    });
    expect(login.statusCode).toBe(200);
    token = login.json<{ accessToken: string }>().accessToken;

    partyId = (
      await withTenantTransaction(db, tenant.id, (transaction) =>
        app.get(PartiesService).createInTransaction(transaction, {
          tenantId: tenant.id,
          actorUserId: owner.id,
          input: { type: 'CONSUMER', displayName: 'مشتری اتمیک' },
        }),
      )
    ).id;
    quoteId = (
      await app.get(PriceQuotesService).createManual({
        tenantId: tenant.id,
        quoteType: 'MAZNEH',
        amountRial: 100_000_000n,
        createdBy: owner.id,
      })
    ).id;

    const validFrom = new Date(Date.now() - 60_000);
    // Z عمداً موجودی ندارد: شکست واقعی (نه تزریقی) در مرحله‌ی موجودی.
    for (const key of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'Z']) {
      items[key] = (
        await jewelry.createItem({
          tenantId: tenant.id,
          code: `ATOMIC-${key}-${randomUUID().slice(0, 6)}`,
          title: `انگشتر ${key}`,
          // J سنگین‌تر است تا اصلاح I→J اختلاف مالی واقعی داشته باشد.
          grossWeightMg: key === 'J' ? 9_000n : 8_000n,
          karat: 750,
          stoneWeightMg: 0n,
          otherDeductionWeightMg: 0n,
          wageType: 'PER_GRAM',
          wageValue: 300_000n,
          validFrom,
          active: true,
        })
      ).jewelryItemId;
    }
    await withTenantTransaction(db, tenant.id, (transaction) =>
      opening.createInTransaction(transaction, {
        tenantId: tenant.id,
        effectiveAt: validFrom,
        description: 'موجودی افتتاحیه‌ی آزمون اتمیک',
        createdBy: owner.id,
        lines: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].map((key) => ({
          itemType: 'JEWELRY' as const,
          itemId: items[key]!,
          quantity: 1n,
        })),
      }),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    expect(fired.splice(0)).toEqual([]);
    expect(await violations()).toEqual([]);
  });

  afterAll(async () => {
    if (tenant.id !== '') {
      await pool.query('DELETE FROM tenants WHERE id = $1', [tenant.id]);
    }
    await app.close();
    await pool.end();
  });

  describe('فروش', () => {
    it('فروش موفق: فاکتور ۱، حرکت موجودی و سند دفتر کل با هم ثبت می‌شوند', async () => {
      const sale = await cashSale('A');

      expect(sale.statusCode).toBe(201);
      expect(sale.body).toMatchObject({ invoiceNumber: 1 });
      expect(await stock('A')).toBe(0n);
      expect(await invoiceNumbers()).toEqual([1]);
    });

    it('شکست بعد از صدور شماره: شماره مصرف نمی‌شود و همان کلید دوباره قابل استفاده است', async () => {
      const before = await footprint();
      const realNext = counters.getNextNumberInTransaction.bind(counters);
      vi.spyOn(counters, 'getNextNumberInTransaction').mockImplementationOnce(async (...args) => {
        await realNext(...args);
        throw new InjectedFailure('after invoice number');
      });
      const key = randomUUID();

      const failed = await cashSale('B', key);

      expectInjected(failed, 'after invoice number');
      expect(await footprint()).toEqual(before);
      expect(await stock('B')).toBe(1n);

      const retried = await cashSale('B', key);
      expect(retried.statusCode).toBe(201);
      expect(retried.body).toMatchObject({ invoiceNumber: 2 });
      expect(await invoiceNumbers()).toEqual([1, 2]);
    });

    it('شکست واقعی هنگام حرکت موجودی (کالای فروخته‌شده): هیچ ردی نمی‌ماند', async () => {
      const before = await footprint();

      const failed = await cashSale('A');

      expect(failed.statusCode).toBeGreaterThanOrEqual(400);
      expect(await footprint()).toEqual(before);
    });

    it('شکست بعد از نوشتن حرکت موجودی: حرکت، پیش‌نویس و شماره برمی‌گردند', async () => {
      const before = await footprint();
      failInventoryAfterWrite('recordInTransaction');

      const failed = await cashSale('C');

      expectInjected(failed, 'inventory movement');
      expect(await footprint()).toEqual(before);
      expect(await stock('C')).toBe(1n);
    });

    it('شکست بعد از نوشتن دفتر کل: سند دفتر کل، حرکت و فاکتور برمی‌گردند', async () => {
      const before = await footprint();
      failLedgerAfterWrite();

      const failed = await cashSale('C');

      expectInjected(failed, 'ledger posting');
      expect(await footprint()).toEqual(before);
      expect(await stock('C')).toBe(1n);
    });

    it('شکست در COMMIT (تراز دفتر کل در constraint تأخیری): کل عملیات برمی‌گردد', async () => {
      const before = await footprint();
      const real = ledger.postInTransaction.bind(ledger);
      vi.spyOn(ledger, 'postInTransaction').mockImplementationOnce(async (transaction, input) => {
        const posted = await real(transaction, input);
        const [first] = posted.entries;
        // یک ردیف نامتوازن؛ trigger تراز فقط در COMMIT اجرا می‌شود.
        fired.push('unbalanced entry');
        await transaction.insert(ledgerEntries).values({
          tenantId: tenant.id,
          transactionId: posted.transaction.id,
          accountId: first!.accountId,
          dimensionId: first!.dimensionId,
          quantity: 1n,
        });
        return posted;
      });

      const failed = await cashSale('C');

      expect(fired.splice(0)).toEqual(['unbalanced entry']);
      expect(failed.statusCode).toBeGreaterThanOrEqual(400);
      expect(await footprint()).toEqual(before);
      expect(await stock('C')).toBe(1n);
    });
  });

  describe('Idempotency', () => {
    it('تکرار همان کلید با همان بدنه همان پاسخ را بدون اثر دوم برمی‌گرداند', async () => {
      const key = randomUUID();
      const effectiveAt = new Date();
      const first = await cashSale('C', key, effectiveAt);
      const afterFirst = await footprint();

      const replay = await cashSale('C', key, effectiveAt);

      expect(first.statusCode).toBe(201);
      expect(first.body).toMatchObject({ invoiceNumber: 3 });
      expect(replay).toEqual(first);
      expect(await footprint()).toEqual(afterFirst);
    });

    it('همان کلید با بدنه‌ی دیگر 409 می‌گیرد و هیچ اثری ندارد', async () => {
      const key = randomUUID();
      expect((await cashSale('D', key)).statusCode).toBe(201);
      const before = await footprint();

      const conflict = await cashSale('E', key);

      expect(conflict.statusCode).toBe(409);
      expect(await footprint()).toEqual(before);
      expect(await stock('E')).toBe(1n);
    });
  });

  describe('دو درخواست هم‌زمان', () => {
    it('همان کلید هم‌زمان: یک فاکتور، دو پاسخ یکسان', async () => {
      const before = await footprint();
      const key = randomUUID();
      const effectiveAt = new Date();

      const [first, second] = await Promise.all([
        cashSale('F', key, effectiveAt),
        cashSale('F', key, effectiveAt),
      ]);

      expect(first.statusCode).toBe(201);
      expect(second).toEqual(first);
      const after = await footprint();
      expect(after.sales_invoices - before.sales_invoices).toBe(1);
      expect(after.ledger_transactions - before.ledger_transactions).toBe(1);
      expect(after.inventory_movements - before.inventory_movements).toBe(1);
    });

    it('دو کلید برای آخرین قطعه‌ی یک کالا: فقط یکی می‌فروشد و شماره‌ی بازنده مصرف نمی‌شود', async () => {
      const results = await Promise.all([cashSale('E'), cashSale('E')]);

      const winners = results.filter((result) => result.statusCode === 201);
      const losers = results.filter((result) => result.statusCode !== 201);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0]!.statusCode).toBeGreaterThanOrEqual(400);
      expect(await stock('E')).toBe(0n);
      expect(await invoiceNumbers()).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('سه فروش هم‌زمان (یکی ناموفق): موفق‌ها شماره‌های پیاپی و بی‌شکاف می‌گیرند', async () => {
      const results = await Promise.all([cashSale('G'), cashSale('H'), cashSale('D')]);

      // D قبلاً فروخته شده؛ همان شکست واقعی موجودی، وسط دو فروش موفق هم‌زمان.
      expect(results.filter((result) => result.statusCode === 201)).toHaveLength(2);
      expect(results[2]!.statusCode).toBeGreaterThanOrEqual(400);
      const numbers = results
        .filter((result) => result.statusCode === 201)
        .map((result) => result.body['invoiceNumber'])
        .sort();
      expect(numbers).toEqual([7, 8]);
      expect(await invoiceNumbers()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });
  });

  describe('اصلاح فاکتور', () => {
    let invoiceId = '';

    it('فروش نسیه‌ی پایه برای اصلاح و تسویه', async () => {
      const sale = await http(
        '/sales/invoices/jewelry/credit',
        { partyId, jewelryItemId: items['I'], quoteId, effectiveAt: new Date().toISOString(), paidRial: '0' },
        randomUUID(),
      );

      expect(sale.statusCode).toBe(201);
      invoiceId = String(sale.body['invoiceId']);
    });

    const amend = (itemKey: string) =>
      http(
        `/sales/invoices/${invoiceId}/amend`,
        {
          reason: 'WEIGHT_ERROR',
          partyId,
          item: { itemType: 'JEWELRY', jewelryItemId: items[itemKey], paidRial: '0' },
        },
        randomUUID(),
      );

    it('شکست واقعی موجودی در اصلاح (کالای جایگزین موجودی ندارد): نسخه‌ی تازه‌ای نمی‌ماند', async () => {
      const before = await footprint();

      const failed = await amend('Z');

      expect(failed.statusCode).toBeGreaterThanOrEqual(400);
      expect(await footprint()).toEqual(before);
      expect(await stock('I')).toBe(0n);
    });

    it('شکست بعد از نوشتن حرکات اصلاحی یا دفتر کل: نسخه، حرکت، audit و سند برمی‌گردند', async () => {
      const before = await footprint();

      failInventoryAfterWrite('recordManyInTransaction');
      expectInjected(await amend('J'), 'inventory movements');
      expect(await footprint()).toEqual(before);

      failLedgerAfterWrite();
      expectInjected(await amend('J'), 'ledger posting');
      expect(await footprint()).toEqual(before);
      expect(await stock('I')).toBe(0n);
      expect(await stock('J')).toBe(1n);
    });

    it('اصلاح موفق: نسخه‌ی ۲، حرکات اصلاحی و سند اصلاحی با هم؛ شماره‌ی فاکتور ثابت', async () => {
      const amended = await amend('J');

      expect(amended.statusCode).toBe(201);
      expect(amended.body).toMatchObject({ invoiceNumber: 9, version: 2 });
      expect(await stock('I')).toBe(1n);
      expect(await stock('J')).toBe(0n);
      expect(await invoiceNumbers()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });

  describe('خرید دست‌دوم', () => {
    const purchase = () =>
      http(
        '/purchase/second-hand/gold',
        {
          partyId,
          grossWeightMg: '5000',
          quoteId,
          effectiveAt: new Date().toISOString(),
          paidRial: '0',
        },
        randomUUID(),
      );

    it('شکست بعد از نوشتن موجودی یا دفتر کل: سند خرید، ردیف‌ها و audit برنمی‌مانند', async () => {
      const before = await footprint();

      failInventoryAfterWrite('recordInTransaction');
      expectInjected(await purchase(), 'inventory movement');
      expect(await footprint()).toEqual(before);

      failLedgerAfterWrite();
      expectInjected(await purchase(), 'ledger posting');
      expect(await footprint()).toEqual(before);
    });

    it('خرید موفق: سند، ردیف، حرکت آبشده و دفتر کل با هم', async () => {
      const before = await footprint();

      const created = await purchase();

      expect(created.statusCode).toBe(201);
      const after = await footprint();
      expect(after.second_hand_purchases - before.second_hand_purchases).toBe(1);
      expect(after.second_hand_purchase_items - before.second_hand_purchase_items).toBe(1);
      expect(after.inventory_movements - before.inventory_movements).toBe(1);
      expect(after.ledger_transactions - before.ledger_transactions).toBe(1);
    });
  });

  describe('تسویه ترکیبی', () => {
    const settle = () =>
      http(
        `/parties/${partyId}/settlements/mixed`,
        {
          lines: [
            { type: 'RIAL', amountRial: '1000000' },
            { type: 'GOLD', grossWeightMg: '1000', karat: 750, quoteId },
          ],
          effectiveAt: new Date().toISOString(),
        },
        randomUUID(),
      );

    it('شکست بعد از نوشتن حرکت طلا یا دفتر کل: نه پیش‌نویس، نه ردیف، نه حرکت', async () => {
      const before = await footprint();

      failInventoryAfterWrite('recordManyInTransaction');
      expectInjected(await settle(), 'inventory movements');
      expect(await footprint()).toEqual(before);

      failLedgerAfterWrite();
      expectInjected(await settle(), 'ledger posting');
      expect(await footprint()).toEqual(before);
    });

    it('تسویه‌ی موفق: سربرگ نهایی، دو ردیف، حرکت طلا و یک سند دفتر کل', async () => {
      const before = await footprint();

      const settled = await settle();

      expect(settled.statusCode).toBe(201);
      const after = await footprint();
      expect(after.settlements - before.settlements).toBe(1);
      expect(after.settlement_lines - before.settlement_lines).toBeGreaterThanOrEqual(2);
      expect(after.inventory_movements - before.inventory_movements).toBe(1);
      expect(after.ledger_transactions - before.ledger_transactions).toBe(1);
    });
  });

  describe('خودِ بررسی‌کننده', () => {
    /*
     * اگر پرس‌وجوی violations همیشه خالی برگردد، همه‌ی آزمون‌های بالا بی‌معنا
     * سبزند. اینجا در یک مستأجر جدا هر نوع ردّ نیمه‌کاره با SQL مستقیم کاشته
     * می‌شود و بررسی‌کننده باید تک‌تکشان را ببیند.
     */
    it('هر ردّ نیمه‌کاره‌ی کاشته‌شده را گزارش می‌کند', async () => {
      const planted = await app.get(TenantService).create({
        name: 'Atomic checker',
        slug: `atomic-checker-${randomUUID().slice(0, 8)}`,
      });
      try {
        const one = async (text: string, params: readonly unknown[]): Promise<string> =>
          (await pool.query<{ id: string }>(text, [...params])).rows[0]!.id;
        const cash = await one(
          `SELECT id FROM ledger_accounts WHERE tenant_id = $1 AND system_key = 'CASH'`,
          [planted.id],
        );
        const bank = await one(
          `SELECT id FROM ledger_accounts WHERE tenant_id = $1 AND system_key = 'BANK'`,
          [planted.id],
        );
        const gold = await one(`SELECT id FROM asset_dimensions WHERE tenant_id = $1 AND code = 'GOLD'`, [
          planted.id,
        ]);
        const party = await one(
          `INSERT INTO parties (tenant_id, type, display_name, normalized_name)
           VALUES ($1, 'CONSUMER', 'x', 'x') RETURNING id`,
          [planted.id],
        );

        const draft = await one(
          `INSERT INTO sales_invoices (tenant_id, status, party_id) VALUES ($1, 'DRAFT', $2) RETURNING id`,
          [planted.id, party],
        );
        const client = await pool.connect();
        let orphanLedger = '';
        try {
          await client.query('BEGIN');
          orphanLedger = (
            await client.query<{ id: string }>(
              `INSERT INTO ledger_transactions (tenant_id, source_type, source_id, effective_at, description)
               VALUES ($1, 'SALES_INVOICE', $2, now(), 'orphan') RETURNING id`,
              [planted.id, randomUUID()],
            )
          ).rows[0]!.id;
          await client.query(
            `INSERT INTO ledger_entries (tenant_id, transaction_id, account_id, dimension_id, quantity)
             VALUES ($1, $2, $3, $5, 10), ($1, $2, $4, $5, -10)`,
            [planted.id, orphanLedger, cash, bank, gold],
          );
          await client.query('COMMIT');
        } finally {
          client.release();
        }
        const orphanMovement = await one(
          `INSERT INTO inventory_movements (tenant_id, source_type, source_id, item_type, dimension_id, quantity, occurred_at)
           VALUES ($1, 'SECOND_HAND_PURCHASE', $2, 'MELTED_GOLD', $3, 10, now()) RETURNING id`,
          [planted.id, randomUUID(), gold],
        );
        await pool.query(
          `INSERT INTO idempotency_records (tenant_id, key, request_hash, status, expires_at)
           VALUES ($1, 'stuck', 'h', 'PENDING', now() + interval '1 day')`,
          [planted.id],
        );
        await pool.query(
          `INSERT INTO document_counters (tenant_id, document_type, period_key, current_value)
           VALUES ($1, 'SALES_INVOICE', 'checker', 1)`,
          [planted.id],
        );

        expect((await violations(planted.id)).sort()).toEqual(
          [
            `draft invoice left behind: ${draft}`,
            `ledger without source document: ${orphanLedger}`,
            `inventory without valid source: ${orphanMovement}`,
            'pending idempotency claim: stuck',
            'invoice number gap: 1',
          ].sort(),
        );
      } finally {
        await pool.query('DELETE FROM tenants WHERE id = $1', [planted.id]);
      }
    });
  });
});
