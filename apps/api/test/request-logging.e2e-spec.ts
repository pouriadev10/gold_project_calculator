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
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { IDEMPOTENCY_KEY_HEADER } from '../src/platform/idempotency/idempotency-key';
import { LOG_DESTINATION } from '../src/platform/logging/logging.tokens';
import { REQUEST_ID_HEADER } from '../src/platform/request-context/request-id';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import { LogCapture } from './support/log-capture';
import type { Database } from '../src/platform/database/connect';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/*
 * خط پایانی درخواست در سطح info است و setup-env سطح تست را `error` می‌گذارد.
 * این فایل در worker خودش اجرا می‌شود، پس تغییرش به بقیه‌ی فایل‌ها نشت نمی‌کند.
 */
const previousLogLevel = process.env.LOG_LEVEL;
process.env.LOG_LEVEL = 'info';

const PASSWORD = 'request-logging-password-1';
const NATIONAL_ID = '0081234567';
const MOBILE = '09121234567';

type InjectResult = {
  readonly statusCode: number;
  readonly headers: Record<string, unknown>;
  json<T>(): T;
};

/**
 * Logging و Observability پایه — BE-067.
 *
 * معیار «تمام است وقتی»: یک فروش از request تا ledger با request ID قابل
 * ردیابی باشد، و masking داده‌ی حساس تست شده باشد. هر دو روی مسیر HTTP
 * واقعی و خروجی **متنی** واقعی logger بررسی می‌شوند.
 */
describe('Logging ساختاریافته (BE-067)', () => {
  const adapter = new FastifyAdapter();
  const logs = new LogCapture();
  const tenant = { id: '', slug: `logging-${randomUUID().slice(0, 12)}` };
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://gold:gold@localhost:5432/gold_test',
  });
  let app: NestFastifyApplication;
  let ownerId = '';
  let accessToken = '';
  let refreshToken = '';
  let partyId = '';
  let quoteId = '';
  const items: string[] = [];

  function authHeaders(key?: string): Record<string, string> {
    return {
      authorization: `Bearer ${accessToken}`,
      'x-tenant-id': tenant.id,
      ...(key === undefined ? {} : { [IDEMPOTENCY_KEY_HEADER]: key }),
    };
  }

  function sell(itemIndex: number): Promise<InjectResult> {
    return adapter.getInstance().inject({
      method: 'POST',
      url: '/sales/invoices/jewelry',
      headers: authHeaders(randomUUID()),
      payload: {
        partyId,
        jewelryItemId: items[itemIndex],
        quoteId,
        effectiveAt: new Date().toISOString(),
      },
    });
  }

  function requestIdOf(response: InjectResult): string {
    const requestId = response.headers[REQUEST_ID_HEADER];
    expect(typeof requestId).toBe('string');
    return requestId as string;
  }

  function completionFor(requestId: string): Record<string, unknown> {
    const lines = logs
      .records()
      .filter((line) => line.event === 'request_completed' && line.requestId === requestId);
    expect(lines).toHaveLength(1);
    return lines[0]!;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LOG_DESTINATION)
      .useValue(logs)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();

    const db = app.get<Database>(DRIZZLE);
    const users = app.get(UserService);
    const jewelry = app.get(JewelryItemsService);

    tenant.id = (await app.get(TenantService).create({ name: 'Request logging', slug: tenant.slug })).id;
    const owner = await users.create({
      email: `${randomUUID().slice(0, 12)}@example.com`,
      displayName: 'Logging owner',
    });
    ownerId = owner.id;
    await users.setPasswordHash(owner.id, await app.get(PasswordService).hash(PASSWORD));
    await app.get(MembershipService).add(tenant.id, { userId: owner.id, roleCode: 'OWNER' });

    // ورود و ساخت مشتری از مسیر HTTP: بدنه‌ی این دو رمز و کد ملی را دارند.
    const login = await adapter.getInstance().inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: owner.email, password: PASSWORD, tenantSlug: tenant.slug },
    });
    expect(login.statusCode).toBe(200);
    ({ accessToken, refreshToken } = login.json<{ accessToken: string; refreshToken: string }>());

    const party = await adapter.getInstance().inject({
      method: 'POST',
      url: '/parties',
      headers: authHeaders(randomUUID()),
      payload: { type: 'CONSUMER', displayName: 'مشتری لاگ', mobile: MOBILE, nationalId: NATIONAL_ID },
    });
    expect(party.statusCode).toBe(201);
    partyId = party.json<{ id: string }>().id;

    quoteId = (
      await app.get(PriceQuotesService).createManual({
        tenantId: tenant.id,
        quoteType: 'MAZNEH',
        amountRial: 100_000_000n,
        createdBy: owner.id,
      })
    ).id;

    const validFrom = new Date(Date.now() - 60_000);
    for (let index = 0; index < 3; index += 1) {
      items.push(
        (
          await jewelry.createItem({
            tenantId: tenant.id,
            code: `LOG-${index}-${randomUUID().slice(0, 6)}`,
            title: `گردنبند ${index}`,
            grossWeightMg: 5_000n,
            karat: 750,
            stoneWeightMg: 0n,
            otherDeductionWeightMg: 0n,
            wageType: 'PER_GRAM',
            wageValue: 300_000n,
            validFrom,
            active: true,
          })
        ).jewelryItemId,
      );
    }
    await withTenantTransaction(db, tenant.id, (transaction) =>
      app.get(OpeningBalancesService).createInTransaction(transaction, {
        tenantId: tenant.id,
        effectiveAt: validFrom,
        description: 'موجودی افتتاحیه‌ی آزمون log',
        createdBy: owner.id,
        lines: items.map((itemId) => ({ itemType: 'JEWELRY' as const, itemId, quantity: 1n })),
      }),
    );
  });

  afterAll(async () => {
    if (tenant.id !== '') {
      await pool.query('DELETE FROM tenants WHERE id = $1', [tenant.id]);
    }
    await app.close();
    await pool.end();
    if (previousLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previousLogLevel;
    }
  });

  describe('ردیابی فروش از request تا ledger', () => {
    let sale: InjectResult;
    let saleBody: { invoiceId: string; ledgerTransactionId: string };
    let requestId = '';

    beforeAll(async () => {
      sale = await sell(0);
      expect(sale.statusCode).toBe(201);
      saleBody = sale.json<{ invoiceId: string; ledgerTransactionId: string }>();
      requestId = requestIdOf(sale);
    });

    it('خط پایانی درخواست همه‌ی داده‌های ردیابی را دارد', () => {
      const line = completionFor(requestId);

      expect(line).toMatchObject({
        level: 'info',
        service: 'gold-api',
        requestId,
        tenantId: tenant.id,
        userId: ownerId,
        method: 'POST',
        endpoint: '/sales/invoices/jewelry',
        statusCode: 201,
        sourceDocuments: [
          {
            sourceType: 'SALES_INVOICE',
            sourceId: saleBody.invoiceId,
            ledgerTransactionId: saleBody.ledgerTransactionId,
          },
        ],
      });
      expect(typeof line.durationMs).toBe('number');
      expect(line).not.toHaveProperty('errorCode');
    });

    it('از request ID در log به سند دفتر کل و فاکتور در دیتابیس می‌رسیم', async () => {
      const [document] = completionFor(requestId).sourceDocuments as {
        sourceType: string;
        sourceId: string;
        ledgerTransactionId: string;
      }[];

      const { rows } = await pool.query<{
        source_type: string;
        source_id: string;
        invoice_status: string;
        entries: number;
      }>(
        `SELECT lt.source_type, lt.source_id, si.status AS invoice_status,
                (SELECT count(*)::int FROM ledger_entries e
                 WHERE e.tenant_id = lt.tenant_id AND e.transaction_id = lt.id) AS entries
         FROM ledger_transactions lt
         JOIN sales_invoices si ON si.tenant_id = lt.tenant_id AND si.id = lt.source_id
         WHERE lt.tenant_id = $1 AND lt.id = $2`,
        [tenant.id, document!.ledgerTransactionId],
      );

      expect(rows).toEqual([
        {
          source_type: 'SALES_INVOICE',
          source_id: document!.sourceId,
          invoice_status: 'FINALIZED',
          entries: expect.any(Number) as number,
        },
      ]);
      expect(rows[0]!.entries).toBeGreaterThan(0);
    });

    it('request ID پاسخ همان request ID خط log است و هیچ خط دیگری مال این درخواست نیست', () => {
      const ownLines = logs.records().filter((line) => line.requestId === requestId);

      expect(ownLines.map((line) => line.event)).toEqual(['request_completed']);
    });
  });

  it('درخواست‌های هم‌زمان: هر خط فقط سند خودش را دارد', async () => {
    const responses = await Promise.all([sell(1), sell(2)]);

    for (const response of responses) {
      expect(response.statusCode).toBe(201);
      const body = response.json<{ invoiceId: string; ledgerTransactionId: string }>();

      expect(completionFor(requestIdOf(response)).sourceDocuments).toEqual([
        { sourceType: 'SALES_INVOICE', sourceId: body.invoiceId, ledgerTransactionId: body.ledgerTransactionId },
      ]);
    }
  });

  describe('خطاها', () => {
    it('خطای validation: سطح warn با کد خطا، مستأجر و کاربر', async () => {
      const response = await adapter.getInstance().inject({
        method: 'POST',
        url: '/sales/invoices/jewelry',
        headers: authHeaders(randomUUID()),
        payload: { partyId },
      });

      expect(response.statusCode).toBe(400);
      expect(completionFor(requestIdOf(response))).toMatchObject({
        level: 'warn',
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        tenantId: tenant.id,
        userId: ownerId,
      });
    });

    it('فروش ناموفق (کالای فروخته‌شده): سند rollback‌شده sourceDocuments نیست', async () => {
      const response = await sell(0);

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      const line = completionFor(requestIdOf(response));
      expect(line).not.toHaveProperty('sourceDocuments');
      expect(line.errorCode).toEqual(expect.any(String));
    });

    it('رد در middleware مستأجر هم خط پایانی و کد خطا دارد', async () => {
      const response = await adapter.getInstance().inject({ method: 'GET', url: '/parties' });

      expect(response.statusCode).toBe(400);
      expect(completionFor(requestIdOf(response))).toMatchObject({
        statusCode: 400,
        errorCode: 'BAD_REQUEST',
        endpoint: '/parties',
      });
    });
  });

  describe('masking داده‌ی حساس', () => {
    it('جست‌وجو با کد ملی: query string در log نمی‌آید', async () => {
      const response = await adapter.getInstance().inject({
        method: 'GET',
        url: `/parties?search=${NATIONAL_ID}`,
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      expect(completionFor(requestIdOf(response))).toMatchObject({ endpoint: '/parties', statusCode: 200 });
    });

    it('رمز، توکن‌ها، کد ملی و موبایل در هیچ جای خروجی log نیستند', () => {
      const text = logs.text();

      expect(logs.lines.length).toBeGreaterThan(0);
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(accessToken);
      expect(text).not.toContain(refreshToken);
      expect(text).not.toContain(NATIONAL_ID);
      expect(text).not.toContain(MOBILE);
    });

    it('ورود: خط پایانی هست ولی بدنه‌اش نه', () => {
      const loginLines = logs
        .records()
        .filter((line) => line.event === 'request_completed' && line.endpoint === '/auth/login');

      expect(loginLines).toHaveLength(1);
      expect(Object.keys(loginLines[0]!).sort()).toEqual(
        ['durationMs', 'endpoint', 'event', 'level', 'method', 'msg', 'requestId', 'service', 'statusCode', 'time'].sort(),
      );
    });
  });
});
