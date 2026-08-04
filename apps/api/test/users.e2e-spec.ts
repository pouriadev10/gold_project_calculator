import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/platform/database/database.module';
import { roles, tenantMemberships, tenants } from '../src/platform/database/schema';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import {
  MembershipAlreadyExistsError,
  MembershipReferenceError,
  UserEmailConflictError,
} from '../src/platform/users/user.errors';
import type { Database } from '../src/platform/database/connect';
import type { INestApplicationContext } from '@nestjs/common';

/**
 * کاربران، نقش‌ها و عضویت — BE-010. نیازمند PostgreSQL واقعی.
 */
describe('کاربران و عضویت (نیازمند PostgreSQL واقعی)', () => {
  let app: INestApplicationContext;
  let db: Database;
  let userService: UserService;
  let memberships: MembershipService;

  const tenantA = { id: '', slug: `u-a-${randomUUID().slice(0, 8)}` };
  const tenantB = { id: '', slug: `u-b-${randomUUID().slice(0, 8)}` };

  const uniqueEmail = (): string => `${randomUUID().slice(0, 12)}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
    userService = app.get(UserService);
    memberships = app.get(MembershipService);

    for (const tenant of [tenantA, tenantB]) {
      const [created] = await db
        .insert(tenants)
        .values({ name: `مستأجر ${tenant.slug}`, slug: tenant.slug })
        .returning();
      tenant.id = created!.id;
    }
  });

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, tenantA.id));
    await db.delete(tenants).where(eq(tenants.id, tenantB.id));
    await app.close();
  });

  describe('نقش‌های seed شده', () => {
    it('هر سه نقش فاز ۱ در دیتابیس هستند', async () => {
      const rows = await db.select().from(roles);
      const codes = rows.map((row) => row.code).sort();

      expect(codes).toEqual(['CASHIER', 'MANAGER', 'OWNER']);
    });

    it('عنوان فارسی دارند', async () => {
      const [owner] = await db.select().from(roles).where(eq(roles.code, 'OWNER'));

      expect(owner?.title).toBe('مالک');
    });
  });

  describe('ساخت کاربر', () => {
    it('کاربر ایجاد می‌شود و پیش‌فرض فعال است', async () => {
      const user = await userService.create({ email: uniqueEmail(), displayName: 'کاربر نمونه' });

      expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(user.status).toBe('ACTIVE');
    });

    it('کاربر با شناسه و با ایمیل خوانده می‌شود', async () => {
      const email = uniqueEmail();
      const created = await userService.create({ email, displayName: 'برای خواندن' });

      expect((await userService.findById(created.id))?.email).toBe(email);
      expect((await userService.findByEmail(email))?.id).toBe(created.id);
    });

    it('جست‌وجوی ایمیل به بزرگی و کوچکی حروف حساس نیست', async () => {
      const email = uniqueEmail();
      await userService.create({ email, displayName: 'x' });

      expect(await userService.findByEmail(email.toUpperCase())).toBeDefined();
    });

    it('ایمیل تکراری رد می‌شود', async () => {
      const email = uniqueEmail();
      await userService.create({ email, displayName: 'اولی' });

      await expect(userService.create({ email, displayName: 'دومی' })).rejects.toBeInstanceOf(
        UserEmailConflictError,
      );
    });
  });

  describe('عضویت', () => {
    it('کاربر با یک نقش به مستأجر متصل می‌شود', async () => {
      const user = await userService.create({ email: uniqueEmail(), displayName: 'عضو' });

      const membership = await memberships.add(tenantA.id, {
        userId: user.id,
        roleCode: 'MANAGER',
      });

      expect(membership.tenantId).toBe(tenantA.id);
      expect(membership.roleCode).toBe('MANAGER');
    });

    it('عضویت تکراری در همان مستأجر رد می‌شود', async () => {
      const user = await userService.create({ email: uniqueEmail(), displayName: 'تکراری' });
      await memberships.add(tenantA.id, { userId: user.id, roleCode: 'CASHIER' });

      await expect(
        memberships.add(tenantA.id, { userId: user.id, roleCode: 'OWNER' }),
      ).rejects.toBeInstanceOf(MembershipAlreadyExistsError);
    });

    it('همان کاربر می‌تواند در مستأجر دیگر نقش دیگری داشته باشد', async () => {
      const user = await userService.create({ email: uniqueEmail(), displayName: 'دو مستأجره' });

      await memberships.add(tenantA.id, { userId: user.id, roleCode: 'OWNER' });
      await memberships.add(tenantB.id, { userId: user.id, roleCode: 'CASHIER' });

      expect(await memberships.findRole(tenantA.id, user.id)).toBe('OWNER');
      expect(await memberships.findRole(tenantB.id, user.id)).toBe('CASHIER');
    });

    it('کاربر ناموجود رد می‌شود', async () => {
      await expect(
        memberships.add(tenantA.id, { userId: randomUUID(), roleCode: 'OWNER' }),
      ).rejects.toBeInstanceOf(MembershipReferenceError);
    });

    it('نقش کاربری که عضو نیست undefined است', async () => {
      const user = await userService.create({ email: uniqueEmail(), displayName: 'بی‌عضویت' });

      expect(await memberships.findRole(tenantA.id, user.id)).toBeUndefined();
    });
  });

  describe('جداسازی مستأجر', () => {
    it('هر مستأجر فقط عضویت‌های خودش را می‌بیند', async () => {
      const userA = await userService.create({ email: uniqueEmail(), displayName: 'فقط الف' });
      const userB = await userService.create({ email: uniqueEmail(), displayName: 'فقط ب' });

      await memberships.add(tenantA.id, { userId: userA.id, roleCode: 'OWNER' });
      await memberships.add(tenantB.id, { userId: userB.id, roleCode: 'OWNER' });

      const listA = await memberships.listForTenant(tenantA.id);
      const listB = await memberships.listForTenant(tenantB.id);

      expect(listA.map((row) => row.userId)).toContain(userA.id);
      expect(listA.map((row) => row.userId)).not.toContain(userB.id);
      expect(listB.map((row) => row.userId)).toContain(userB.id);
      expect(listB.map((row) => row.userId)).not.toContain(userA.id);
    });

    it('مستأجر الف نقش کاربرِ مستأجر ب را نمی‌بیند', async () => {
      const userB = await userService.create({ email: uniqueEmail(), displayName: 'مال ب' });
      await memberships.add(tenantB.id, { userId: userB.id, roleCode: 'MANAGER' });

      // همان کاربر، ولی از دید مستأجر الف — RLS باید ردیف را پنهان کند.
      expect(await memberships.findRole(tenantA.id, userB.id)).toBeUndefined();
      expect(await memberships.findRole(tenantB.id, userB.id)).toBe('MANAGER');
    });

    it('جداسازی کار PostgreSQL است، نه شرط کوئری', async () => {
      // بدون helper و با کاربر مهاجرت، همان جدول همه‌ی ردیف‌ها را می‌دهد.
      const all = await db.select().from(tenantMemberships);
      const tenantIds = new Set(all.map((row) => row.tenantId));

      expect(tenantIds.size).toBeGreaterThan(1);
    });
  });
});
