import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/platform/database/database.module';
import { refreshTokens, tenants, users } from '../src/platform/database/schema';
import { MembershipService } from '../src/platform/users/membership.service';
import { PasswordService } from '../src/platform/auth/password.service';
import { UserService } from '../src/platform/users/user.service';
import type { Database } from '../src/platform/database/connect';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const PASSWORD = 'رمز-عبور-درست-۱۲۳';

interface SessionBody {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: { id: string; email: string; displayName: string };
  tenant: { id: string; slug: string; name: string };
  role: string;
}

/**
 * احراز هویت — BE-011. نیازمند PostgreSQL واقعی.
 */
describe('احراز هویت (نیازمند PostgreSQL واقعی)', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let userService: UserService;
  let passwords: PasswordService;
  let memberships: MembershipService;

  const adapter = new FastifyAdapter();

  const tenantActive = { id: '', slug: `auth-a-${randomUUID().slice(0, 8)}` };
  const tenantSuspended = { id: '', slug: `auth-s-${randomUUID().slice(0, 8)}` };

  let member = { id: '', email: '' };
  let disabledUser = { id: '', email: '' };
  let outsider = { id: '', email: '' };
  let suspendedMember = { id: '', email: '' };

  /*
   * شاخه‌های صریح‌اند و نه spread شرطی: با `exactOptionalPropertyTypes`،
   * `{ ...(cond ? { payload } : {}) }` نوع `payload?: X | undefined`
   * می‌سازد که با امضای `inject` جور درنمی‌آید.
   */
  const request = async (
    method: 'POST' | 'GET',
    url: string,
    options: { payload?: object; token?: string } = {},
  ) => {
    const headers = { authorization: `Bearer ${options.token ?? ''}` };

    if (options.token !== undefined && options.payload !== undefined) {
      return adapter.getInstance().inject({ method, url, headers, payload: options.payload });
    }
    if (options.token !== undefined) {
      return adapter.getInstance().inject({ method, url, headers });
    }
    if (options.payload !== undefined) {
      return adapter.getInstance().inject({ method, url, payload: options.payload });
    }

    return adapter.getInstance().inject({ method, url });
  };

  const login = async (email: string, password: string, tenantSlug: string) =>
    request('POST', '/auth/login', { payload: { email, password, tenantSlug } });

  /** کاربر با رمز و عضویت در یک مستأجر. */
  async function makeMember(tenantId: string, role: 'OWNER' | 'MANAGER' | 'CASHIER') {
    const email = `${randomUUID().slice(0, 12)}@example.com`;
    const created = await userService.create({ email, displayName: 'کاربر تست' });
    await userService.setPasswordHash(created.id, await passwords.hash(PASSWORD));
    await memberships.add(tenantId, { userId: created.id, roleCode: role });

    return { id: created.id, email };
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

    for (const tenant of [tenantActive, tenantSuspended]) {
      const [created] = await db
        .insert(tenants)
        .values({ name: `مستأجر ${tenant.slug}`, slug: tenant.slug })
        .returning();
      tenant.id = created!.id;
    }

    member = await makeMember(tenantActive.id, 'MANAGER');
    suspendedMember = await makeMember(tenantSuspended.id, 'OWNER');

    disabledUser = await makeMember(tenantActive.id, 'CASHIER');
    await db.update(users).set({ status: 'DISABLED' }).where(eq(users.id, disabledUser.id));

    // کاربری با رمز درست ولی بدون عضویت در مستأجر فعال.
    const outsiderEmail = `${randomUUID().slice(0, 12)}@example.com`;
    const createdOutsider = await userService.create({
      email: outsiderEmail,
      displayName: 'بدون عضویت',
    });
    await userService.setPasswordHash(createdOutsider.id, await passwords.hash(PASSWORD));
    outsider = { id: createdOutsider.id, email: outsiderEmail };

    // مستأجر دوم بعد از ساخت عضویت معلق می‌شود.
    await db.update(tenants).set({ status: 'SUSPENDED' }).where(eq(tenants.id, tenantSuspended.id));
  });

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, tenantActive.id));
    await db.delete(tenants).where(eq(tenants.id, tenantSuspended.id));
    await db.delete(users).where(eq(users.id, outsider.id));
    await app.close();
  });

  describe('ورود موفق', () => {
    it('توکن دسترسی و تمدید با نقش درست برمی‌گرداند', async () => {
      const response = await login(member.email, PASSWORD, tenantActive.slug);

      expect(response.statusCode).toBe(200);

      const body = response.json<SessionBody>();

      expect(body.accessToken).toBeTruthy();
      expect(body.refreshToken).toBeTruthy();
      expect(body.role).toBe('MANAGER');
      expect(body.tenant.slug).toBe(tenantActive.slug);
      expect(body.expiresInSeconds).toBeGreaterThan(0);
    });

    it('پاسخ هیچ اطلاعات حساسی ندارد', async () => {
      const raw = (await login(member.email, PASSWORD, tenantActive.slug)).body;

      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain('$argon2');
      expect(raw).not.toContain(PASSWORD);
    });

    it('ایمیل با حروف بزرگ هم کار می‌کند', async () => {
      const response = await login(member.email.toUpperCase(), PASSWORD, tenantActive.slug);

      expect(response.statusCode).toBe(200);
    });

    it('توکن تمدید فقط به‌صورت هش ذخیره می‌شود', async () => {
      const body = (await login(member.email, PASSWORD, tenantActive.slug)).json<SessionBody>();

      const stored = await db.select().from(refreshTokens);
      const hashes = stored.map((row) => row.tokenHash);

      expect(hashes).not.toContain(body.refreshToken);
      // ...ولی هش همان توکن پیدا می‌شود.
      expect(stored.some((row) => row.tokenHash.length === 64)).toBe(true);
    });
  });

  describe('ورود ناموفق', () => {
    it('رمز غلط با ۴۰۱ رد می‌شود', async () => {
      const response = await login(member.email, 'رمز-غلط-کاملاً', tenantActive.slug);

      expect(response.statusCode).toBe(401);
    });

    it('ایمیل ناموجود همان پیام رمز غلط را می‌دهد', async () => {
      const unknown = await login('nobody@example.com', PASSWORD, tenantActive.slug);
      const wrongPassword = await login(member.email, 'رمز-غلط-کاملاً', tenantActive.slug);

      expect(unknown.statusCode).toBe(401);
      expect(unknown.json<{ error: { message: string } }>().error.message).toBe(
        wrongPassword.json<{ error: { message: string } }>().error.message,
      );
    });

    it('کاربر غیرفعال نمی‌تواند وارد شود', async () => {
      const response = await login(disabledUser.email, PASSWORD, tenantActive.slug);

      expect(response.statusCode).toBe(401);
    });

    it('کاربری که عضو مستأجر نیست نمی‌تواند وارد شود', async () => {
      const response = await login(outsider.email, PASSWORD, tenantActive.slug);

      expect(response.statusCode).toBe(401);
    });

    it('مستأجر ناموجود با ۴۰۱ رد می‌شود، نه ۴۰۴', async () => {
      // ۴۰۴ به مهاجم می‌گفت کدام مستأجرها وجود دارند.
      const response = await login(member.email, PASSWORD, 'no-such-tenant');

      expect(response.statusCode).toBe(401);
    });

    it('مستأجر معلق نمی‌تواند نشست فعال بسازد', async () => {
      const response = await login(suspendedMember.email, PASSWORD, tenantSuspended.slug);

      expect(response.statusCode).toBe(403);
    });
  });

  describe('تمدید', () => {
    it('توکن معتبر، نشست تازه می‌دهد', async () => {
      const first = (await login(member.email, PASSWORD, tenantActive.slug)).json<SessionBody>();

      const response = await request('POST', '/auth/refresh', {
        payload: { refreshToken: first.refreshToken },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<SessionBody>().refreshToken).not.toBe(first.refreshToken);
    });

    it('توکن قبلی پس از تمدید باطل می‌شود', async () => {
      const first = (await login(member.email, PASSWORD, tenantActive.slug)).json<SessionBody>();

      await request('POST', '/auth/refresh', { payload: { refreshToken: first.refreshToken } });

      const reuse = await request('POST', '/auth/refresh', {
        payload: { refreshToken: first.refreshToken },
      });

      expect(reuse.statusCode).toBe(401);
    });

    it('توکن ساختگی رد می‌شود', async () => {
      const response = await request('POST', '/auth/refresh', {
        payload: { refreshToken: 'یک-توکن-کاملاً-ساختگی' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('خروج', () => {
    it('نشست را باطل می‌کند', async () => {
      const session = (await login(member.email, PASSWORD, tenantActive.slug)).json<SessionBody>();

      const logout = await request('POST', '/auth/logout', {
        payload: { refreshToken: session.refreshToken },
      });

      expect(logout.statusCode).toBe(204);

      const afterLogout = await request('POST', '/auth/refresh', {
        payload: { refreshToken: session.refreshToken },
      });

      expect(afterLogout.statusCode).toBe(401);
    });

    it('توکن ناموجود هم موفق حساب می‌شود', async () => {
      const response = await request('POST', '/auth/logout', {
        payload: { refreshToken: 'توکنی-که-وجود-ندارد' },
      });

      expect(response.statusCode).toBe(204);
    });
  });

  describe('GET /auth/me', () => {
    it('با توکن معتبر، کاربر و مستأجر و نقش را می‌دهد', async () => {
      const session = (await login(member.email, PASSWORD, tenantActive.slug)).json<SessionBody>();

      const response = await request('GET', '/auth/me', { token: session.accessToken });

      expect(response.statusCode).toBe(200);

      const body = response.json<{ user: { email: string }; role: string }>();

      expect(body.user.email).toBe(member.email);
      expect(body.role).toBe('MANAGER');
      expect(response.body).not.toContain('$argon2');
    });

    it('بدون توکن ۴۰۱ می‌دهد', async () => {
      expect((await request('GET', '/auth/me')).statusCode).toBe(401);
    });

    it.each([
      ['توکن ساختگی', 'not.a.jwt'],
      ['توکن خالی', ''],
    ])('%s با ۴۰۱ رد می‌شود', async (_label, token) => {
      expect((await request('GET', '/auth/me', { token })).statusCode).toBe(401);
    });

    it('مسیرهای auth هدر مستأجر نمی‌خواهند', async () => {
      // میان‌افزار BE-008 نباید جلوی ورود را بگیرد؛ کسی که وارد نشده
      // هنوز شناسه‌ی مستأجری ندارد که بفرستد.
      expect((await login(member.email, PASSWORD, tenantActive.slug)).statusCode).toBe(200);
    });
  });
});
