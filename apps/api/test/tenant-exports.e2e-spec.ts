import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TENANT_EXPORT_FORMAT,
  TENANT_EXPORT_SCHEMA_VERSION,
  tenantExportDocumentSchema,
  tenantExportSchema,
} from '@gold/contracts';
import { AppModule } from '../src/app.module';
import { JewelryItemsService } from '../src/modules/inventory/jewelry-items.service';
import { OpeningBalancesService } from '../src/modules/inventory/opening-balances.service';
import { PriceQuotesService } from '../src/modules/pricing/price-quotes.service';
import { PasswordService } from '../src/platform/auth/password.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { CONTENT_SHA256_HEADER } from '../src/platform/exports/tenant-exports.controller';
import { EXCLUDED_TENANT_TABLES, TENANT_EXPORT_SECTIONS } from '../src/platform/exports/tenant-export.sections';
import { PDF_FILE_NAME_HEADER } from '../src/platform/files/pdf-response';
import { IDEMPOTENCY_KEY_HEADER } from '../src/platform/idempotency/idempotency-key';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import type { TenantExport, TenantExportDocument } from '@gold/contracts';
import type { Database } from '../src/platform/database/connect';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const PASSWORD = 'tenant-export-password-1';

interface TenantFixture {
  id: string;
  slug: string;
  ownerId: string;
  ownerToken: string;
  managerToken: string;
  partyId: string;
  partyName: string;
  nationalId: string;
  invoiceId: string;
}

type InjectResult = {
  readonly statusCode: number;
  readonly headers: Record<string, unknown>;
  readonly body: string;
  json<T>(): T;
};

/**
 * خروجی کامل داده‌ی مستأجر — BE-069.
 *
 * معیار «تمام است وقتی»: مستأجر داده‌ی کامل خودش را دانلود کند، هیچ داده‌ی
 * مستأجر دیگری وارد خروجی نشود، و schema خروجی نسخه داشته باشد. جداسازی با
 * جست‌وجوی **همه‌ی** شناسه‌های مستأجر ب (از هر جدول خروجی) در متن خام فایل
 * مستأجر الف آزموده می‌شود، نه فقط چند فیلد نمونه.
 */
describe('خروجی کامل داده‌ی مستأجر (BE-069)', () => {
  const adapter = new FastifyAdapter();
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://gold:gold@localhost:5432/gold_test',
  });
  let app: NestFastifyApplication;
  const a = {} as TenantFixture;
  const b = {} as TenantFixture;

  function inject(
    method: 'GET' | 'POST',
    url: string,
    tenant: TenantFixture,
    token: string,
    payload?: object,
    key = randomUUID(),
  ): Promise<InjectResult> {
    return adapter.getInstance().inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': tenant.id,
        ...(method === 'POST' ? { [IDEMPOTENCY_KEY_HEADER]: key } : {}),
      },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  async function login(email: string, slug: string): Promise<string> {
    const response = await adapter.getInstance().inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: PASSWORD, tenantSlug: slug },
    });
    expect(response.statusCode).toBe(200);
    return response.json<{ accessToken: string }>().accessToken;
  }

  async function seedTenant(fixture: TenantFixture, label: string): Promise<void> {
    const db = app.get<Database>(DRIZZLE);
    const users = app.get(UserService);
    const passwords = app.get(PasswordService);
    const memberships = app.get(MembershipService);

    fixture.slug = `export-${label}-${randomUUID().slice(0, 10)}`;
    fixture.id = (await app.get(TenantService).create({ name: `Export ${label}`, slug: fixture.slug })).id;

    const tokens: Record<string, string> = {};
    for (const role of ['OWNER', 'MANAGER'] as const) {
      const user = await users.create({
        email: `${role.toLowerCase()}-${randomUUID().slice(0, 10)}@example.com`,
        displayName: `${role} ${label}`,
      });
      await users.setPasswordHash(user.id, await passwords.hash(PASSWORD));
      await memberships.add(fixture.id, { userId: user.id, roleCode: role });
      tokens[role] = await login(user.email, fixture.slug);
      if (role === 'OWNER') fixture.ownerId = user.id;
    }
    fixture.ownerToken = tokens['OWNER']!;
    fixture.managerToken = tokens['MANAGER']!;

    fixture.partyName = `مشتری ${label} ${randomUUID().slice(0, 8)}`;
    fixture.nationalId = `${label === 'a' ? '11' : '22'}${randomUUID().replace(/\D/gu, '').padEnd(8, '7').slice(0, 8)}`;
    const party = await inject('POST', '/parties', fixture, fixture.ownerToken, {
      type: 'CONSUMER',
      displayName: fixture.partyName,
      nationalId: fixture.nationalId,
    });
    expect(party.statusCode).toBe(201);
    fixture.partyId = party.json<{ id: string }>().id;

    const quoteId = (
      await app.get(PriceQuotesService).createManual({
        tenantId: fixture.id,
        quoteType: 'MAZNEH',
        amountRial: 100_000_000n,
        createdBy: fixture.ownerId,
      })
    ).id;
    const validFrom = new Date(Date.now() - 60_000);
    const itemId = (
      await app.get(JewelryItemsService).createItem({
        tenantId: fixture.id,
        code: `EXP-${label}-${randomUUID().slice(0, 6)}`,
        title: `دستبند ${label}`,
        grossWeightMg: 6_000n,
        karat: 750,
        stoneWeightMg: 0n,
        otherDeductionWeightMg: 0n,
        wageType: 'PER_GRAM',
        wageValue: 300_000n,
        validFrom,
        active: true,
      })
    ).jewelryItemId;
    await withTenantTransaction(db, fixture.id, (transaction) =>
      app.get(OpeningBalancesService).createInTransaction(transaction, {
        tenantId: fixture.id,
        effectiveAt: validFrom,
        description: `موجودی افتتاحیه‌ی ${label}`,
        createdBy: fixture.ownerId,
        lines: [{ itemType: 'JEWELRY' as const, itemId, quantity: 1n }],
      }),
    );

    const sale = await inject('POST', '/sales/invoices/jewelry', fixture, fixture.ownerToken, {
      partyId: fixture.partyId,
      jewelryItemId: itemId,
      quoteId,
      effectiveAt: new Date().toISOString(),
    });
    expect(sale.statusCode).toBe(201);
    fixture.invoiceId = sale.json<{ invoiceId: string }>().invoiceId;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();

    await seedTenant(a, 'a');
    await seedTenant(b, 'b');
  });

  afterAll(async () => {
    const ids = [a.id, b.id].filter((id) => id !== undefined);
    if (ids.length > 0) {
      await pool.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
    }
    await app.close();
    await pool.end();
  });

  describe('ساخت و دانلود', () => {
    let created: TenantExport;
    let download: InjectResult;
    let document: TenantExportDocument;
    const key = randomUUID();

    beforeAll(async () => {
      const response = await inject('POST', '/platform/exports/full', a, a.ownerToken, undefined, key);
      expect(response.statusCode).toBe(201);
      created = tenantExportSchema.parse(response.json());

      download = await inject('GET', `/platform/exports/${created.id}`, a, a.ownerToken);
      expect(download.statusCode).toBe(200);
      document = tenantExportDocumentSchema.parse(JSON.parse(download.body));
    });

    it('schema خروجی نسخه و قالب اعلام‌شده دارد', () => {
      expect(created).toMatchObject({
        format: TENANT_EXPORT_FORMAT,
        schemaVersion: TENANT_EXPORT_SCHEMA_VERSION,
        requestedBy: a.ownerId,
      });
      expect(document).toMatchObject({
        format: TENANT_EXPORT_FORMAT,
        schemaVersion: TENANT_EXPORT_SCHEMA_VERSION,
        exportId: created.id,
        snapshotAt: created.snapshotAt,
        tenant: { id: a.id, slug: a.slug, name: 'Export a' },
      });
      expect(Object.keys(document.sections)).toEqual(TENANT_EXPORT_SECTIONS.map((section) => section.name));
    });

    it('فایل دانلودی همان بایت‌هایی است که sha256 و اندازه‌اش اعلام شده', () => {
      const sha256 = createHash('sha256').update(download.body, 'utf8').digest('hex');

      expect(sha256).toBe(created.sha256);
      expect(download.headers[CONTENT_SHA256_HEADER.toLowerCase()]).toBe(created.sha256);
      expect(Buffer.byteLength(download.body, 'utf8')).toBe(created.byteSize);
      expect(download.headers['content-type']).toMatch(/^application\/json/u);
      expect(decodeURIComponent(String(download.headers[PDF_FILE_NAME_HEADER.toLowerCase()]))).toMatch(
        new RegExp(`^tenant-export-${a.slug}-\\d{4}-\\d{2}-\\d{2}-[0-9a-f]{8}\\.json$`, 'u'),
      );
    });

    it('کامل است: تعداد ردیف هر بخش برابر داده‌ی مستأجر در دیتابیس', async () => {
      for (const section of TENANT_EXPORT_SECTIONS) {
        // audit ساخت و دانلود همین خروجی بعد از snapshot نوشته شده‌اند، پس در فایل نیستند.
        const { rows } = await pool.query<{ n: number }>(
          section.name === 'users'
            ? `SELECT count(*)::int AS n FROM tenant_memberships WHERE tenant_id = $1`
            : section.name === 'auditLogs'
              ? `SELECT count(*)::int AS n FROM audit_logs
                 WHERE tenant_id = $1 AND NOT (entity_type = 'tenant_export' AND entity_id = $2::text)`
              : `SELECT count(*)::int AS n FROM ${section.table} WHERE tenant_id = $1`,
          section.name === 'auditLogs' ? [a.id, created.id] : [a.id],
        );
        const expected = rows[0]!.n;

        expect({ section: section.name, rows: document.sections[section.name]!.rowCount }).toEqual({
          section: section.name,
          rows: expected,
        });
        expect(created.rowCounts[section.name]).toBe(document.sections[section.name]!.rowCount);
      }
    });

    it('سند فروش، دفتر کل و مشتری (با کد ملی خودش) در فایل هستند؛ عدد bigint رشته است', () => {
      const sections = document.sections;

      expect(sections['salesInvoices']!.rows.map((row) => row.id)).toContain(a.invoiceId);
      expect(sections['ledgerTransactions']!.rows.map((row) => row.sourceId)).toContain(a.invoiceId);
      expect(sections['parties']!.rows).toContainEqual(
        expect.objectContaining({ id: a.partyId, displayName: a.partyName, nationalId: a.nationalId }),
      );
      expect(sections['ledgerEntries']!.rowCount).toBeGreaterThan(0);
      for (const entry of sections['ledgerEntries']!.rows) {
        expect(typeof entry.quantity).toBe('string');
      }
      expect(sections['users']!.rows.map((row) => Object.keys(row).sort())).toEqual([
        ['displayName', 'id'],
        ['displayName', 'id'],
      ]);
    });

    it('audit log بدون IP و user agent', () => {
      const audit = document.sections['auditLogs']!.rows;

      expect(audit.length).toBeGreaterThan(0);
      for (const row of audit) {
        expect(row).not.toHaveProperty('ipAddress');
        expect(row).not.toHaveProperty('userAgent');
      }
    });

    it('هیچ داده‌ی مستأجر دیگر: هیچ شناسه‌ای از هیچ جدول مستأجر ب در متن فایل نیست', async () => {
      const foreignIds = new Set<string>([b.id, b.ownerId]);
      for (const section of TENANT_EXPORT_SECTIONS) {
        if (section.name === 'users') continue;
        const { rows } = await pool.query<{ id: string }>(
          `SELECT id::text FROM ${section.table} WHERE tenant_id = $1`,
          [b.id],
        );
        for (const row of rows) foreignIds.add(row.id);
      }

      expect(foreignIds.size).toBeGreaterThan(20);
      const leaked = [...foreignIds].filter((id) => download.body.includes(id));
      expect(leaked).toEqual([]);
      expect(download.body).not.toContain(b.slug);
      expect(download.body).not.toContain(b.partyName);
      expect(download.body).not.toContain(b.nationalId);
    });

    it('هر ردیف جدول مستأجردار متعلق به همین مستأجر است', () => {
      for (const [name, section] of Object.entries(document.sections)) {
        if (name === 'users') continue;
        for (const row of section.rows) {
          expect({ name, tenantId: row.tenantId }).toEqual({ name, tenantId: a.id });
        }
      }
    });

    it('تکرار با همان کلید همان خروجی را برمی‌گرداند و خروجی دوم نمی‌سازد', async () => {
      const replay = await inject('POST', '/platform/exports/full', a, a.ownerToken, undefined, key);

      expect(replay.statusCode).toBe(201);
      expect(replay.json<TenantExport>().id).toBe(created.id);
      const { rows } = await pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM tenant_exports WHERE tenant_id = $1',
        [a.id],
      );
      expect(rows[0]!.n).toBe(1);
    });

    it('ساخت و دانلود در audit ثبت می‌شوند', async () => {
      const { rows } = await pool.query<{ action: string; actor: string }>(
        `SELECT action, actor_user_id::text AS actor FROM audit_logs
         WHERE tenant_id = $1 AND entity_type = 'tenant_export' AND entity_id = $2 ORDER BY created_at`,
        [a.id, created.id],
      );

      expect(rows).toEqual([
        { action: 'TENANT_EXPORT_CREATED', actor: a.ownerId },
        { action: 'TENANT_EXPORT_DOWNLOADED', actor: a.ownerId },
      ]);
    });

    it('خروجی ذخیره‌شده append-only است', async () => {
      await expect(
        pool.query(`UPDATE tenant_exports SET content = '{}' WHERE id = $1`, [created.id]),
      ).rejects.toThrow(/append-only/u);
      await expect(pool.query('DELETE FROM tenant_exports WHERE id = $1', [created.id])).rejects.toThrow(
        /append-only/u,
      );
    });

    it('مستأجر دیگر خروجی الف را نمی‌بیند: همان ۴۰۴ شناسه‌ی تصادفی', async () => {
      const foreign = await inject('GET', `/platform/exports/${created.id}`, b, b.ownerToken);
      const random = await inject('GET', `/platform/exports/${randomUUID()}`, b, b.ownerToken);

      expect(foreign.statusCode).toBe(404);
      expect(random.statusCode).toBe(404);
      expect(foreign.json<{ error: { message: string } }>().error.message).toBe(
        random.json<{ error: { message: string } }>().error.message,
      );
    });

    it('فقط OWNER: مدیر نه می‌سازد نه دانلود می‌کند', async () => {
      const post = await inject('POST', '/platform/exports/full', a, a.managerToken);
      const get = await inject('GET', `/platform/exports/${created.id}`, a, a.managerToken);

      expect(post.statusCode).toBe(403);
      expect(get.statusCode).toBe(403);
    });
  });

  it('خروجی مستأجر ب هم فقط داده‌ی خودش را دارد', async () => {
    const created = await inject('POST', '/platform/exports/full', b, b.ownerToken);
    expect(created.statusCode).toBe(201);
    const download = await inject('GET', `/platform/exports/${created.json<TenantExport>().id}`, b, b.ownerToken);

    expect(download.body).toContain(b.invoiceId);
    expect(download.body).not.toContain(a.id);
    expect(download.body).not.toContain(a.invoiceId);
    expect(download.body).not.toContain(a.nationalId);
  });

  it('هر جدول دارای tenant_id یا در خروجی است یا با دلیل کنار گذاشته شده', async () => {
    const { rows } = await pool.query<{ table: string }>(
      `SELECT c.relname AS "table"
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
       ORDER BY 1`,
    );
    const covered = new Set([
      ...TENANT_EXPORT_SECTIONS.map((section) => section.table),
      ...Object.keys(EXCLUDED_TENANT_TABLES),
    ]);

    expect(rows.map((row) => row.table).filter((table) => !covered.has(table))).toEqual([]);
    expect(
      Object.keys(EXCLUDED_TENANT_TABLES).filter((table) =>
        TENANT_EXPORT_SECTIONS.some((section) => section.table === table),
      ),
    ).toEqual([]);
  });
});
