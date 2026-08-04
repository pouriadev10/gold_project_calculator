import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/platform/database/database.module';
import { tenantMemberships, tenants, users } from '../src/platform/database/schema';
import { MembershipService } from '../src/platform/users/membership.service';
import { PasswordService } from '../src/platform/auth/password.service';
import { UserService } from '../src/platform/users/user.service';
import type { Database } from '../src/platform/database/connect';
import type { RoleCode } from '../src/platform/database/schema';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const PASSWORD = 'رمز-عبور-درست-۱۲۳';

const OWNER_ONLY = '/internal/dev/authz/owner-only';
const SENSITIVE = '/internal/dev/authz/sensitive-setting';
const WHOAMI = '/internal/dev/authz/whoami';

interface Member {
  id: string;
  email: string;
  token: string;
}

/**
 * مجوزدهی نقش‌محور — BE-012. نیازمند PostgreSQL واقعی.
 *
 * هر چهار حالتی که تسک خواسته پوشش دارد: بدون login، user خارج tenant،
 * نقش ناکافی، و نقش معتبر.
 */
describe('مجوزدهی نقش‌محور (نیازمند PostgreSQL واقعی)', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let userService: UserService;
  let passwords: PasswordService;
  let memberships: MembershipService;

  const adapter = new FastifyAdapter();

  const tenantA = { id: '', slug: `az-a-${randomUUID().slice(0, 8)}` };
  const tenantB = { id: '', slug: `az-b-${randomUUID().slice(0, 8)}` };

  let owner: Member;
  let manager: Member;
  let cashier: Member;
  let otherTenantOwner: Member;

  async function call(
    method: 'GET' | 'POST',
    url: string,
    options: { token?: string; tenantId?: string } = {},
  ) {
    const headers: Record<string, string> = {};

    if (options.token !== undefined) {
      headers['authorization'] = `Bearer ${options.token}`;
    }
    if (options.tenantId !== undefined) {
      headers['x-tenant-id'] = options.tenantId;
    }

    return adapter.getInstance().inject({ method, url, headers });
  }

  /** کاربر با رمز، عضویت، و توکن دسترسی آماده. */
  async function makeMember(tenant: { id: string; slug: string }, role: RoleCode): Promise<Member> {
    const email = `${randomUUID().slice(0, 12)}@example.com`;
    const created = await userService.create({ email, displayName: `کاربر ${role}` });
    await userService.setPasswordHash(created.id, await passwords.hash(PASSWORD));
    await memberships.add(tenant.id, { userId: created.id, roleCode: role });

    const login = await adapter.getInstance().inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: PASSWORD, tenantSlug: tenant.slug },
    });

    return { id: created.id, email, token: login.json<{ accessToken: string }>().accessToken };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();

    db = app.get<Database>(DRIZZLE);
    userService = app.get(UserService);
    passwords = app.get(PasswordService);
    memberships = app.get(MembershipService);

    for (const tenant of [tenantA, tenantB]) {
      const [created] = await db
        .insert(tenants)
        .values({ name: `مستأجر ${tenant.slug}`, slug: tenant.slug })
        .returning();
      tenant.id = created!.id;
    }

    owner = await makeMember(tenantA, 'OWNER');
    manager = await makeMember(tenantA, 'MANAGER');
    cashier = await makeMember(tenantA, 'CASHIER');
    otherTenantOwner = await makeMember(tenantB, 'OWNER');
  });

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, tenantA.id));
    await db.delete(tenants).where(eq(tenants.id, tenantB.id));
    await app.close();
  });

  describe('بدون login', () => {
    it('بدون توکن ۴۰۱ می‌دهد', async () => {
      const response = await call('POST', SENSITIVE, { tenantId: tenantA.id });

      expect(response.statusCode).toBe(401);
    });

    it('توکن ساختگی ۴۰۱ می‌دهد', async () => {
      const response = await call('POST', SENSITIVE, {
        token: 'not.a.real.jwt',
        tenantId: tenantA.id,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('user خارج tenant', () => {
    it('توکن مستأجر ب روی مستأجر الف ۴۰۳ می‌گیرد', async () => {
      // بدون این بررسی، عضو یک طلافروشی با همان توکن به داده‌ی
      // طلافروشی دیگر دست می‌زد.
      const response = await call('POST', SENSITIVE, {
        token: otherTenantOwner.token,
        tenantId: tenantA.id,
      });

      expect(response.statusCode).toBe(403);
    });

    it('همان توکن روی مستأجر خودش کار می‌کند', async () => {
      const response = await call('POST', SENSITIVE, {
        token: otherTenantOwner.token,
        tenantId: tenantB.id,
      });

      expect(response.statusCode).toBe(200);
    });

    it('بدون هدر مستأجر، درخواست پیش از نگهبان رد می‌شود', async () => {
      const response = await call('POST', SENSITIVE, { token: owner.token });

      expect(response.statusCode).toBe(400);
    });

    /**
     * سناریوی واقعیِ خطرناک — و تنها حالتی که بررسی `tid` را ضروری می‌کند.
     *
     * نسخه‌ی اول این فایل فقط کاربری را می‌آزمود که عضو مستأجر دوم نبود؛
     * آن تست حتی با حذف بررسی `tid` هم سبز می‌ماند، چون جست‌وجوی عضویت
     * خودش جلویش را می‌گرفت. برای کاربری که عضو **هر دو** مستأجر است
     * داستان فرق می‌کند: جست‌وجوی عضویت موفق می‌شود و نقشِ مستأجر اشتباه
     * را برمی‌گرداند. بدون مقایسه‌ی `tid`، صندوق‌دارِ یک طلافروشی با توکن
     * همان‌جا روی طلافروشی دیگر مالک می‌شد.
     */
    it('کاربر عضو دو مستأجر نمی‌تواند با توکن یکی روی دیگری عمل کند', async () => {
      const email = `${randomUUID().slice(0, 12)}@example.com`;
      const created = await userService.create({ email, displayName: 'عضو دو مستأجر' });
      await userService.setPasswordHash(created.id, await passwords.hash(PASSWORD));

      await memberships.add(tenantA.id, { userId: created.id, roleCode: 'OWNER' });
      await memberships.add(tenantB.id, { userId: created.id, roleCode: 'CASHIER' });

      // ورود به مستأجر ب، جایی که فقط صندوق‌دار است.
      const login = await adapter.getInstance().inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: PASSWORD, tenantSlug: tenantB.slug },
      });
      const token = login.json<{ accessToken: string; role: string }>();

      expect(token.role).toBe('CASHIER');

      // همان توکن، ولی نشانه‌رفته به مستأجر الف که آنجا مالک است.
      const response = await call('POST', OWNER_ONLY, {
        token: token.accessToken,
        tenantId: tenantA.id,
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('نقش ناکافی', () => {
    it('CASHIER نمی‌تواند تنظیمات حساس را تغییر دهد', async () => {
      const response = await call('POST', SENSITIVE, {
        token: cashier.token,
        tenantId: tenantA.id,
      });

      expect(response.statusCode).toBe(403);
    });

    it('MANAGER به مسیر فقط-مالک دسترسی ندارد — فهرست سفید است، نه سلسله‌مراتب', async () => {
      const response = await call('POST', OWNER_ONLY, {
        token: manager.token,
        tenantId: tenantA.id,
      });

      expect(response.statusCode).toBe(403);
    });

    it('CASHIER هم به مسیر فقط-مالک دسترسی ندارد', async () => {
      const response = await call('POST', OWNER_ONLY, {
        token: cashier.token,
        tenantId: tenantA.id,
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('نقش معتبر', () => {
    it('OWNER به تنظیمات حساس دسترسی دارد', async () => {
      const response = await call('POST', SENSITIVE, { token: owner.token, tenantId: tenantA.id });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ userId: string }>().userId).toBe(owner.id);
    });

    it('MANAGER به تنظیمات حساس دسترسی دارد', async () => {
      const response = await call('POST', SENSITIVE, {
        token: manager.token,
        tenantId: tenantA.id,
      });

      expect(response.statusCode).toBe(200);
    });

    it('OWNER به مسیر فقط-مالک دسترسی دارد', async () => {
      const response = await call('POST', OWNER_ONLY, { token: owner.token, tenantId: tenantA.id });

      expect(response.statusCode).toBe(200);
    });

    it('بدون @Roles، هر عضو مستأجر دسترسی دارد — حتی CASHIER', async () => {
      const response = await call('GET', WHOAMI, { token: cashier.token, tenantId: tenantA.id });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ tenantId: string }>().tenantId).toBe(tenantA.id);
    });
  });

  describe('نقش از دیتابیس خوانده می‌شود، نه از توکن', () => {
    it('تنزل نقش بلافاصله اثر می‌کند، بدون انتظار برای انقضای توکن', async () => {
      const demoted = await makeMember(tenantA, 'MANAGER');

      // با توکنی که ادعای MANAGER دارد، دسترسی برقرار است.
      expect(
        (await call('POST', SENSITIVE, { token: demoted.token, tenantId: tenantA.id })).statusCode,
      ).toBe(200);

      await db
        .update(tenantMemberships)
        .set({ roleCode: 'CASHIER' })
        .where(
          and(eq(tenantMemberships.tenantId, tenantA.id), eq(tenantMemberships.userId, demoted.id)),
        );

      // همان توکن دست‌نخورده — ولی نقش واقعی عوض شده است.
      expect(
        (await call('POST', SENSITIVE, { token: demoted.token, tenantId: tenantA.id })).statusCode,
      ).toBe(403);
    });

    it('حذف عضویت بلافاصله دسترسی را قطع می‌کند', async () => {
      const removed = await makeMember(tenantA, 'OWNER');

      expect(
        (await call('GET', WHOAMI, { token: removed.token, tenantId: tenantA.id })).statusCode,
      ).toBe(200);

      await db
        .delete(tenantMemberships)
        .where(
          and(eq(tenantMemberships.tenantId, tenantA.id), eq(tenantMemberships.userId, removed.id)),
        );

      expect(
        (await call('GET', WHOAMI, { token: removed.token, tenantId: tenantA.id })).statusCode,
      ).toBe(403);

      await db.delete(users).where(eq(users.id, removed.id));
    });
  });
});
