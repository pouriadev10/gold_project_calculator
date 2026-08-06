import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/platform/auth/password.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import { auditLogs, jewelryItemVersions, tenants } from '../src/platform/database/schema';
import { TENANT_HEADER } from '../src/platform/request-context/request-context.errors';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import {
  InactiveJewelryItemError,
  JewelryItemNotFoundError,
} from '../src/modules/inventory/jewelry-items.errors';
import { JewelryItemsService } from '../src/modules/inventory/jewelry-items.service';
import type { Database } from '../src/platform/database/connect';
import type { RoleCode } from '../src/platform/database/schema';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const PASSWORD = 'رمز-عبور-کالا-۱۲۳';
const BASE_URL = '/inventory/jewelry-items';

/**
 * حروف از کد یونیکد ساخته می‌شوند و نه از نویسه‌ی خام: «ی» فارسی و «ي»
 * عربی در ویرایشگر یکسان دیده می‌شوند و تستِ جست‌وجو بی‌معنا می‌شد.
 */
const PERSIAN_YEH = String.fromCodePoint(0x06cc);
const ARABIC_YEH = String.fromCodePoint(0x064a);
const PERSIAN_KAF = String.fromCodePoint(0x06a9);
const ARABIC_KAF = String.fromCodePoint(0x0643);

interface TenantFixture {
  id: string;
  slug: string;
}

interface Member {
  id: string;
  token: string;
}

interface JewelryItemResponse {
  id: string;
  jewelryItemId: string;
  code: string;
  title: string;
  grossWeightMg: string;
  karat: number;
  stoneWeightMg: string;
  otherDeductionWeightMg: string;
  wageType: 'PER_GRAM' | 'PERCENT_X100' | 'FLAT';
  wageValue: string;
  validFrom: string;
  validTo: string | null;
  version: number;
  active: boolean;
}

interface JewelryItemListResponse {
  items: JewelryItemResponse[];
  total: number;
  limit: number;
  offset: number;
}

/** API کالای زیورآلات — BE-026. نیازمند PostgreSQL واقعی. */
describe('API کالای زیورآلات (نیازمند PostgreSQL واقعی)', () => {
  const adapter = new FastifyAdapter();
  const tenantA: TenantFixture = { id: '', slug: `jwapi-a-${randomUUID().slice(0, 12)}` };
  const tenantB: TenantFixture = { id: '', slug: `jwapi-b-${randomUUID().slice(0, 12)}` };

  let app: NestFastifyApplication;
  let db: Database;
  let users: UserService;
  let passwords: PasswordService;
  let memberships: MembershipService;
  let items: JewelryItemsService;
  let ownerA: Member;
  let ownerB: Member;
  let cashierA: Member;

  const uniqueCode = (prefix = 'RING'): string => `${prefix}-${randomUUID().slice(0, 8)}`;

  async function makeMember(tenant: TenantFixture, role: RoleCode): Promise<Member> {
    const user = await users.create({
      email: `${randomUUID().slice(0, 12)}@example.com`,
      displayName: `کاربر ${role}`,
    });
    await users.setPasswordHash(user.id, await passwords.hash(PASSWORD));
    await memberships.add(tenant.id, { userId: user.id, roleCode: role });

    const login = await adapter.getInstance().inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password: PASSWORD, tenantSlug: tenant.slug },
    });
    expect(login.statusCode).toBe(200);

    return { id: user.id, token: login.json<{ accessToken: string }>().accessToken };
  }

  function headers(member: Member, tenant: TenantFixture): Record<string, string> {
    return { authorization: `Bearer ${member.token}`, [TENANT_HEADER]: tenant.id };
  }

  function writeHeaders(
    member: Member,
    tenant: TenantFixture,
    key = randomUUID(),
  ): Record<string, string> {
    return { ...headers(member, tenant), 'idempotency-key': key };
  }

  /** انگشتر نمونه: ۱۲ گرم ناخالص، ۲ گرم نگین، عیار ۷۵۰، اجرت گرمی. */
  function samplePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      code: uniqueCode(),
      title: 'انگشتر نگین‌دار',
      grossWeightMg: '12000',
      karat: 750,
      stoneWeightMg: '2000',
      otherDeductionWeightMg: '0',
      wageType: 'PER_GRAM',
      wageValue: '350000',
      validFrom: '2026-01-01T00:00:00Z',
      ...overrides,
    };
  }

  async function createItem(
    member: Member,
    tenant: TenantFixture,
    overrides: Record<string, unknown> = {},
    key = randomUUID(),
  ) {
    return adapter.getInstance().inject({
      method: 'POST',
      url: BASE_URL,
      headers: writeHeaders(member, tenant, key),
      payload: samplePayload(overrides),
    });
  }

  async function createdItem(
    member: Member,
    tenant: TenantFixture,
    overrides: Record<string, unknown> = {},
  ): Promise<JewelryItemResponse> {
    const response = await createItem(member, tenant, overrides);
    expect(response.statusCode).toBe(201);

    return response.json<JewelryItemResponse>();
  }

  async function patchItem(
    member: Member,
    tenant: TenantFixture,
    id: string,
    payload: Record<string, unknown>,
    key = randomUUID(),
  ) {
    return adapter.getInstance().inject({
      method: 'PATCH',
      url: `${BASE_URL}/${id}`,
      headers: writeHeaders(member, tenant, key),
      payload,
    });
  }

  async function deactivateItem(
    member: Member,
    tenant: TenantFixture,
    id: string,
    key = randomUUID(),
  ) {
    return adapter.getInstance().inject({
      method: 'POST',
      url: `${BASE_URL}/${id}/deactivate`,
      headers: writeHeaders(member, tenant, key),
    });
  }

  async function listItems(
    member: Member,
    tenant: TenantFixture,
    query = '',
  ): Promise<JewelryItemListResponse> {
    const response = await adapter.getInstance().inject({
      method: 'GET',
      url: `${BASE_URL}${query}`,
      headers: headers(member, tenant),
    });
    expect(response.statusCode).toBe(200);

    return response.json<JewelryItemListResponse>();
  }

  async function versionRows(tenant: TenantFixture, jewelryItemId: string) {
    return withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(jewelryItemVersions)
        .where(
          and(
            eq(jewelryItemVersions.tenantId, tenant.id),
            eq(jewelryItemVersions.jewelryItemId, jewelryItemId),
          ),
        )
        .orderBy(jewelryItemVersions.version),
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();

    db = app.get<Database>(DRIZZLE);
    users = app.get(UserService);
    passwords = app.get(PasswordService);
    memberships = app.get(MembershipService);
    items = app.get(JewelryItemsService);

    for (const tenant of [tenantA, tenantB]) {
      const [created] = await db
        .insert(tenants)
        .values({ name: `مستأجر ${tenant.slug}`, slug: tenant.slug })
        .returning();
      tenant.id = created!.id;
    }

    ownerA = await makeMember(tenantA, 'OWNER');
    ownerB = await makeMember(tenantB, 'OWNER');
    cashierA = await makeMember(tenantA, 'CASHIER');
  });

  afterAll(async () => {
    for (const tenant of [tenantA, tenantB]) {
      if (tenant.id !== '') {
        await db.delete(tenants).where(eq(tenants.id, tenant.id));
      }
    }
    await app?.close();
  });

  describe('ایجاد کالا', () => {
    it('کالا با نسخه‌ی ۱ ساخته می‌شود و وزن‌ها رشته برمی‌گردند', async () => {
      const code = uniqueCode();
      const item = await createdItem(ownerA, tenantA, { code });

      expect(item).toMatchObject({
        code,
        version: 1,
        active: true,
        grossWeightMg: '12000',
        stoneWeightMg: '2000',
        karat: 750,
        wageType: 'PER_GRAM',
        wageValue: '350000',
        validTo: null,
      });
      expect(typeof item.grossWeightMg).toBe('string');
      expect(typeof item.wageValue).toBe('string');
    });

    it('وزن خالص در پاسخ نیست — مشتق است، نه فیلد', async () => {
      const item = await createdItem(ownerA, tenantA);

      expect(Object.keys(item)).not.toContain('pureWeightMg');
      expect(Object.keys(item)).not.toContain('netWeightMg');
    });

    it('کسورات اختیاری‌اند و پیش‌فرضشان صفر است', async () => {
      const response = await adapter.getInstance().inject({
        method: 'POST',
        url: BASE_URL,
        headers: writeHeaders(ownerA, tenantA),
        payload: {
          code: uniqueCode(),
          title: 'حلقه ساده',
          grossWeightMg: '5000',
          karat: 750,
          wageType: 'FLAT',
          wageValue: '1000000',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json<JewelryItemResponse>()).toMatchObject({
        stoneWeightMg: '0',
        otherDeductionWeightMg: '0',
      });
    });

    it.each([
      ['وزن اعشاری', { grossWeightMg: '12.5' }],
      ['وزن به‌صورت عدد', { grossWeightMg: 12000 }],
      ['ارقام فارسی', { grossWeightMg: '۱۲۰۰۰' }],
      ['وزن ناخالص صفر', { grossWeightMg: '0' }],
      ['عیار خارج از بازه', { karat: 1001 }],
      ['نوع اجرت ناشناخته', { wageType: 'HOURLY' }],
      ['فیلد ناشناخته', { pureWeightMg: '7500' }],
    ])('ورودی نامعتبر رد می‌شود: %s', async (_label, override) => {
      const response = await createItem(ownerA, tenantA, override);

      expect(response.statusCode).toBe(400);
    });

    it('کسورات بیشتر از وزن ناخالص با ۴۰۰ رد می‌شود', async () => {
      const response = await createItem(ownerA, tenantA, {
        grossWeightMg: '5000',
        stoneWeightMg: '6000',
      });

      expect(response.statusCode).toBe(400);
    });

    it('کد تکراری در همان مستأجر ۴۰۹ می‌گیرد ولی در مستأجر دیگر آزاد است', async () => {
      const code = uniqueCode();
      await createdItem(ownerA, tenantA, { code });

      const duplicate = await createItem(ownerA, tenantA, { code });
      const otherTenant = await createItem(ownerB, tenantB, { code });

      expect(duplicate.statusCode).toBe(409);
      expect(otherTenant.statusCode).toBe(201);
    });

    it('صندوق‌دار اجازه‌ی ساخت کالا ندارد', async () => {
      const response = await createItem(cashierA, tenantA);

      expect(response.statusCode).toBe(403);
    });

    it('بدون Idempotency-Key رد می‌شود', async () => {
      const response = await adapter.getInstance().inject({
        method: 'POST',
        url: BASE_URL,
        headers: headers(ownerA, tenantA),
        payload: samplePayload(),
      });

      expect(response.statusCode).toBe(400);
    });

    it('تکرار همان کلید کالای دوم نمی‌سازد', async () => {
      const key = randomUUID();
      const code = uniqueCode();
      const first = await createItem(ownerA, tenantA, { code }, key);
      const replay = await createItem(ownerA, tenantA, { code }, key);

      expect(first.statusCode).toBe(201);
      expect(replay.statusCode).toBe(201);
      expect(replay.json<JewelryItemResponse>().id).toBe(first.json<JewelryItemResponse>().id);
    });

    it('عنوان فارسی هنگام نوشتن نرمال‌سازی می‌شود', async () => {
      // با «ي» و «ك» عربی تایپ شده؛ باید با حروف فارسی ذخیره شود.
      const item = await createdItem(ownerA, tenantA, {
        title: `دستبند ${ARABIC_KAF}ول${ARABIC_YEH}ه`,
      });

      expect(item.title).toBe(`دستبند ${PERSIAN_KAF}ول${PERSIAN_YEH}ه`);
    });

    it('ممیزیِ ساخت کالا با شناسه‌ی کاربر ثبت می‌شود', async () => {
      const item = await createdItem(ownerA, tenantA);

      const audit = await withTenantTransaction(db, tenantA.id, (transaction) =>
        transaction
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.tenantId, tenantA.id),
              eq(auditLogs.entityId, item.jewelryItemId),
              eq(auditLogs.action, 'JEWELRY_ITEM_CREATED'),
            ),
          ),
      );

      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actorUserId: ownerA.id, entityType: 'jewelry_item' });
    });
  });

  describe('فهرست و جست‌وجو', () => {
    it('جست‌وجو بر اساس کد کار می‌کند', async () => {
      const code = uniqueCode('SEARCHCODE');
      const item = await createdItem(ownerA, tenantA, { code });

      const page = await listItems(ownerA, tenantA, `?search=${code}`);

      expect(page.items.map((row) => row.id)).toEqual([item.id]);
      expect(page.total).toBe(1);
    });

    it('جست‌وجوی عنوان با یای عربی، عنوان ذخیره‌شده با یای فارسی را پیدا می‌کند', async () => {
      const marker = randomUUID().slice(0, 8);
      const item = await createdItem(ownerA, tenantA, {
        title: `گردنبند ون${PERSIAN_YEH}ز ${marker}`,
      });

      const page = await listItems(
        ownerA,
        tenantA,
        `?search=${encodeURIComponent(`ون${ARABIC_YEH}ز ${marker}`)}`,
      );

      expect(page.items.map((row) => row.id)).toEqual([item.id]);
    });

    it('نیم‌فاصله و فاصله در جست‌وجو یکسان دیده می‌شوند', async () => {
      const marker = randomUUID().slice(0, 8);
      await createdItem(ownerA, tenantA, { title: `نگین‌دار ${marker}` });

      const page = await listItems(
        ownerA,
        tenantA,
        `?search=${encodeURIComponent(`نگین دار ${marker}`)}`,
      );

      expect(page.items).toHaveLength(1);
    });

    it('کاراکتر wildcard در ورودی جست‌وجو معنای خودش را ندارد', async () => {
      await createdItem(ownerA, tenantA);

      const page = await listItems(ownerA, tenantA, '?search=%25');

      expect(page.items).toHaveLength(0);
      expect(page.total).toBe(0);
    });

    it('فیلتر فعال و غیرفعال از هم جدا هستند', async () => {
      const prefix = `FILTER${randomUUID().slice(0, 6)}`;
      const active = await createdItem(ownerA, tenantA, { code: uniqueCode(prefix) });
      const inactive = await createdItem(ownerA, tenantA, { code: uniqueCode(prefix) });
      expect((await deactivateItem(ownerA, tenantA, inactive.jewelryItemId)).statusCode).toBe(200);

      const activeOnly = await listItems(ownerA, tenantA, `?search=${prefix}&active=true`);
      const inactiveOnly = await listItems(ownerA, tenantA, `?search=${prefix}&active=false`);
      const all = await listItems(ownerA, tenantA, `?search=${prefix}`);

      expect(activeOnly.items.map((row) => row.jewelryItemId)).toEqual([active.jewelryItemId]);
      expect(inactiveOnly.items.map((row) => row.jewelryItemId)).toEqual([inactive.jewelryItemId]);
      expect(all.total).toBe(2);
    });

    it('صفحه‌بندی total را پیش از برش برمی‌گرداند', async () => {
      const prefix = `PAGE${randomUUID().slice(0, 6)}`;
      for (const index of [1, 2, 3]) {
        await createdItem(ownerA, tenantA, { code: `${prefix}-${index}` });
      }

      const first = await listItems(ownerA, tenantA, `?search=${prefix}&limit=2&offset=0`);
      const second = await listItems(ownerA, tenantA, `?search=${prefix}&limit=2&offset=2`);

      expect(first.items).toHaveLength(2);
      expect(first).toMatchObject({ total: 3, limit: 2, offset: 0 });
      expect(second.items).toHaveLength(1);
      expect(second).toMatchObject({ total: 3, offset: 2 });
      expect(new Set([...first.items, ...second.items].map((row) => row.id)).size).toBe(3);
    });

    it('هر کالا فقط با نسخه‌ی باز در فهرست می‌آید', async () => {
      const code = uniqueCode('OPENONLY');
      const item = await createdItem(ownerA, tenantA, { code });
      const patched = await patchItem(ownerA, tenantA, item.jewelryItemId, { karat: 995 });
      expect(patched.statusCode).toBe(200);

      const page = await listItems(ownerA, tenantA, `?search=${code}`);

      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({ version: 2, karat: 995, validTo: null });
    });

    it('کالای مستأجر دیگر در فهرست دیده نمی‌شود', async () => {
      const code = uniqueCode('ISOLATED');
      const foreign = await createdItem(ownerB, tenantB, { code });

      const page = await listItems(ownerA, tenantA, `?search=${code}`);

      expect(page.items.map((row) => row.id)).not.toContain(foreign.id);
      expect(page.total).toBe(0);
    });

    it('limit خارج از بازه رد می‌شود', async () => {
      const response = await adapter.getInstance().inject({
        method: 'GET',
        url: `${BASE_URL}?limit=1000`,
        headers: headers(ownerA, tenantA),
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('دریافت یک کالا', () => {
    it('پیش‌فرض، نسخه‌ی باز را می‌دهد', async () => {
      const item = await createdItem(ownerA, tenantA);

      const response = await adapter.getInstance().inject({
        method: 'GET',
        url: `${BASE_URL}/${item.jewelryItemId}`,
        headers: headers(ownerA, tenantA),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<JewelryItemResponse>()).toMatchObject({ id: item.id, version: 1 });
    });

    it('با `at` نسخه‌ی همان روز برمی‌گردد — همان چیزی که فاکتور آن روز دید', async () => {
      const item = await createdItem(ownerA, tenantA, {
        validFrom: '2026-01-01T00:00:00Z',
        wageValue: '350000',
      });
      const patched = await patchItem(ownerA, tenantA, item.jewelryItemId, {
        wageValue: '500000',
        validFrom: '2026-03-01T00:00:00Z',
      });
      expect(patched.statusCode).toBe(200);

      const inJanuary = await adapter.getInstance().inject({
        method: 'GET',
        url: `${BASE_URL}/${item.jewelryItemId}?at=2026-01-15T00:00:00Z`,
        headers: headers(ownerA, tenantA),
      });
      const inApril = await adapter.getInstance().inject({
        method: 'GET',
        url: `${BASE_URL}/${item.jewelryItemId}?at=2026-04-15T00:00:00Z`,
        headers: headers(ownerA, tenantA),
      });

      expect(inJanuary.json<JewelryItemResponse>()).toMatchObject({
        version: 1,
        wageValue: '350000',
      });
      expect(inApril.json<JewelryItemResponse>()).toMatchObject({
        version: 2,
        wageValue: '500000',
      });
    });

    it('کالای ناموجود ۴۰۴ می‌دهد و کالای مستأجر دیگر هم همین‌طور', async () => {
      const foreign = await createdItem(ownerB, tenantB);

      const missing = await adapter.getInstance().inject({
        method: 'GET',
        url: `${BASE_URL}/${randomUUID()}`,
        headers: headers(ownerA, tenantA),
      });
      const crossTenant = await adapter.getInstance().inject({
        method: 'GET',
        url: `${BASE_URL}/${foreign.jewelryItemId}`,
        headers: headers(ownerA, tenantA),
      });

      expect(missing.statusCode).toBe(404);
      expect(crossTenant.statusCode).toBe(404);
    });

    it('شناسه‌ی غیر UUID ۴۰۰ می‌گیرد', async () => {
      const response = await adapter.getInstance().inject({
        method: 'GET',
        url: `${BASE_URL}/not-a-uuid`,
        headers: headers(ownerA, tenantA),
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('ویرایش — مرز نسخه‌سازی', () => {
    it.each([
      ['عیار', { karat: 995 }],
      ['وزن ناخالص', { grossWeightMg: '13000' }],
      ['وزن نگین', { stoneWeightMg: '2500' }],
      ['نوع اجرت', { wageType: 'FLAT' }],
      ['مبلغ اجرت', { wageValue: '420000' }],
    ])('تغییر %s نسخه‌ی جدید می‌سازد', async (_label, payload) => {
      const item = await createdItem(ownerA, tenantA);

      const response = await patchItem(ownerA, tenantA, item.jewelryItemId, payload);

      expect(response.statusCode).toBe(200);
      expect(response.json<JewelryItemResponse>()).toMatchObject({ version: 2, validTo: null });
      expect(await versionRows(tenantA, item.jewelryItemId)).toHaveLength(2);
    });

    it('نسخه‌ی قبلی بسته می‌شود و اعدادش دست‌نخورده می‌ماند', async () => {
      const item = await createdItem(ownerA, tenantA, {
        validFrom: '2026-01-01T00:00:00Z',
        wageValue: '350000',
        karat: 750,
      });

      await patchItem(ownerA, tenantA, item.jewelryItemId, {
        karat: 995,
        wageValue: '600000',
        validFrom: '2026-03-01T00:00:00Z',
      });

      const rows = await versionRows(tenantA, item.jewelryItemId);
      expect(rows[0]).toMatchObject({ version: 1, karat: 750, wageValue: 350_000n });
      expect(rows[0]?.validTo?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
      expect(rows[1]).toMatchObject({ version: 2, karat: 995, wageValue: 600_000n, validTo: null });
    });

    it('تغییر عنوان روی همان نسخه می‌نشیند و شماره‌ی نسخه را جلو نمی‌برد', async () => {
      const item = await createdItem(ownerA, tenantA, { title: 'انگشتر قدیمی' });

      const response = await patchItem(ownerA, tenantA, item.jewelryItemId, {
        title: 'انگشتر جدید',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<JewelryItemResponse>()).toMatchObject({
        id: item.id,
        version: 1,
        title: 'انگشتر جدید',
      });
      expect(await versionRows(tenantA, item.jewelryItemId)).toHaveLength(1);
    });

    it('عنوان جدید بلافاصله قابل جست‌وجوست', async () => {
      const marker = randomUUID().slice(0, 8);
      const item = await createdItem(ownerA, tenantA, { title: 'عنوان اولیه' });

      await patchItem(ownerA, tenantA, item.jewelryItemId, { title: `زنجیر ${marker}` });
      const page = await listItems(ownerA, tenantA, `?search=${encodeURIComponent(marker)}`);

      expect(page.items.map((row) => row.id)).toEqual([item.id]);
    });

    it('تغییر عنوان نسخه‌های بسته را دست نمی‌زند', async () => {
      const item = await createdItem(ownerA, tenantA, {
        title: 'عنوان نسخه‌ی یک',
        validFrom: '2026-01-01T00:00:00Z',
      });
      await patchItem(ownerA, tenantA, item.jewelryItemId, {
        karat: 995,
        validFrom: '2026-03-01T00:00:00Z',
      });

      await patchItem(ownerA, tenantA, item.jewelryItemId, { title: 'عنوان تازه' });

      const rows = await versionRows(tenantA, item.jewelryItemId);
      expect(rows[0]).toMatchObject({ version: 1, title: 'عنوان نسخه‌ی یک' });
      expect(rows[1]).toMatchObject({ version: 2, title: 'عنوان تازه' });
    });

    it('تغییر همزمان عنوان و عیار فقط یک نسخه می‌سازد', async () => {
      const item = await createdItem(ownerA, tenantA, { title: 'اول' });

      const response = await patchItem(ownerA, tenantA, item.jewelryItemId, {
        title: 'دوم',
        karat: 995,
      });

      expect(response.json<JewelryItemResponse>()).toMatchObject({
        version: 2,
        title: 'دوم',
        karat: 995,
      });
      expect(await versionRows(tenantA, item.jewelryItemId)).toHaveLength(2);
    });

    it('ارسال همان مقادیر فعلی نسخه‌ی جدید نمی‌سازد', async () => {
      const item = await createdItem(ownerA, tenantA);

      const response = await patchItem(ownerA, tenantA, item.jewelryItemId, {
        karat: item.karat,
        wageValue: item.wageValue,
        title: item.title,
      });

      expect(response.json<JewelryItemResponse>()).toMatchObject({ id: item.id, version: 1 });
      expect(await versionRows(tenantA, item.jewelryItemId)).toHaveLength(1);
    });

    it('تاریخ اعتبار عقب‌تر از نسخه‌ی فعلی ۴۰۹ می‌گیرد', async () => {
      const item = await createdItem(ownerA, tenantA, { validFrom: '2026-01-01T00:00:00Z' });

      const response = await patchItem(ownerA, tenantA, item.jewelryItemId, {
        karat: 995,
        validFrom: '2025-12-01T00:00:00Z',
      });

      expect(response.statusCode).toBe(409);
    });

    it('بدنه‌ی خالی و کد در بدنه رد می‌شوند', async () => {
      const item = await createdItem(ownerA, tenantA);

      const empty = await patchItem(ownerA, tenantA, item.jewelryItemId, {});
      const withCode = await patchItem(ownerA, tenantA, item.jewelryItemId, { code: 'NEW-CODE' });

      expect(empty.statusCode).toBe(400);
      expect(withCode.statusCode).toBe(400);
    });

    it('کالای ناموجود ۴۰۴ و صندوق‌دار ۴۰۳ می‌گیرد', async () => {
      const item = await createdItem(ownerA, tenantA);

      const missing = await patchItem(ownerA, tenantA, randomUUID(), { karat: 995 });
      const forbidden = await patchItem(cashierA, tenantA, item.jewelryItemId, { karat: 995 });

      expect(missing.statusCode).toBe(404);
      expect(forbidden.statusCode).toBe(403);
    });
  });

  describe('غیرفعال‌سازی', () => {
    it('کالا غیرفعال می‌شود بدون آنکه نسخه‌ی تازه بسازد', async () => {
      const item = await createdItem(ownerA, tenantA);

      const response = await deactivateItem(ownerA, tenantA, item.jewelryItemId);

      expect(response.statusCode).toBe(200);
      expect(response.json<JewelryItemResponse>()).toMatchObject({
        id: item.id,
        version: 1,
        active: false,
      });
      expect(await versionRows(tenantA, item.jewelryItemId)).toHaveLength(1);
    });

    it('کالای غیرفعال در فروش جدید قابل انتخاب نیست', async () => {
      const item = await createdItem(ownerA, tenantA, { validFrom: '2026-01-01T00:00:00Z' });
      const before = await items.requireSelectableForSale(
        tenantA.id,
        item.jewelryItemId,
        new Date('2026-06-01T00:00:00Z'),
      );
      expect(before.id).toBe(item.id);

      await deactivateItem(ownerA, tenantA, item.jewelryItemId);

      await expect(
        items.requireSelectableForSale(
          tenantA.id,
          item.jewelryItemId,
          new Date('2026-06-01T00:00:00Z'),
        ),
      ).rejects.toBeInstanceOf(InactiveJewelryItemError);
    });

    it('کالای ناموجود برای فروش هم رد می‌شود', async () => {
      await expect(
        items.requireSelectableForSale(tenantA.id, randomUUID(), new Date()),
      ).rejects.toBeInstanceOf(JewelryItemNotFoundError);
    });

    it('ویرایش مشخصات، کالای غیرفعال را دوباره فعال نمی‌کند', async () => {
      const item = await createdItem(ownerA, tenantA);
      await deactivateItem(ownerA, tenantA, item.jewelryItemId);

      const response = await patchItem(ownerA, tenantA, item.jewelryItemId, { karat: 995 });

      expect(response.json<JewelryItemResponse>()).toMatchObject({ version: 2, active: false });
    });

    it('تکرار غیرفعال‌سازی بی‌اثر است', async () => {
      const item = await createdItem(ownerA, tenantA);
      await deactivateItem(ownerA, tenantA, item.jewelryItemId);

      const again = await deactivateItem(ownerA, tenantA, item.jewelryItemId);

      expect(again.statusCode).toBe(200);
      expect(again.json<JewelryItemResponse>()).toMatchObject({ active: false, version: 1 });
      expect(await versionRows(tenantA, item.jewelryItemId)).toHaveLength(1);
    });

    it('غیرفعال‌سازی در ممیزی ثبت می‌شود', async () => {
      const item = await createdItem(ownerA, tenantA);
      await deactivateItem(ownerA, tenantA, item.jewelryItemId);

      const audit = await withTenantTransaction(db, tenantA.id, (transaction) =>
        transaction
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.tenantId, tenantA.id),
              eq(auditLogs.entityId, item.id),
              eq(auditLogs.action, 'JEWELRY_ITEM_DEACTIVATED'),
            ),
          ),
      );

      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actorUserId: ownerA.id });
    });

    it('کالا حذف فیزیکی نمی‌شود — endpoint حذف وجود ندارد', async () => {
      const item = await createdItem(ownerA, tenantA);

      const response = await adapter.getInstance().inject({
        method: 'DELETE',
        url: `${BASE_URL}/${item.jewelryItemId}`,
        headers: writeHeaders(ownerA, tenantA),
      });

      expect(response.statusCode).toBe(404);
      expect(await versionRows(tenantA, item.jewelryItemId)).toHaveLength(1);
    });

    it('کالای مستأجر دیگر غیرفعال نمی‌شود', async () => {
      const foreign = await createdItem(ownerB, tenantB);

      const response = await deactivateItem(ownerA, tenantA, foreign.jewelryItemId);

      expect(response.statusCode).toBe(404);
      expect((await versionRows(tenantB, foreign.jewelryItemId))[0]?.active).toBe(true);
    });
  });
});
