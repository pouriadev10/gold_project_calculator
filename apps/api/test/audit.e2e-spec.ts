import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/platform/database/database.module';
import { auditLogs, tenantMemberships, tenants } from '../src/platform/database/schema';
import { PasswordService } from '../src/platform/auth/password.service';
import { TENANT_HEADER } from '../src/platform/request-context/request-context.errors';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Database } from '../src/platform/database/connect';
import type { RoleCode } from '../src/platform/database/schema';

const PASSWORD = 'رمز-عبور-آزمون-۱۲۳';

interface Member {
  readonly id: string;
  readonly token: string;
}

/** Audit واقعی با جدول RLS و trigger PostgreSQL. */
describe('audit log تغییرناپذیر (نیازمند PostgreSQL واقعی)', () => {
  const adapter = new FastifyAdapter();
  const tenant = { id: '', slug: `audit-${randomUUID().slice(0, 12)}` };

  let app: NestFastifyApplication;
  let db: Database;
  let usersService: UserService;
  let passwords: PasswordService;
  let memberships: MembershipService;
  let owner: Member;
  let cashier: Member;

  async function makeMember(role: RoleCode): Promise<Member> {
    const email = `${randomUUID().slice(0, 12)}@example.com`;
    const user = await usersService.create({ email, displayName: `کاربر ${role}` });
    await usersService.setPasswordHash(user.id, await passwords.hash(PASSWORD));
    await memberships.add(tenant.id, { userId: user.id, roleCode: role });

    const login = await adapter.getInstance().inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: PASSWORD, tenantSlug: tenant.slug },
    });

    expect(login.statusCode).toBe(200);
    return { id: user.id, token: login.json<{ accessToken: string }>().accessToken };
  }

  const authenticatedPost = (url: string, payload?: object) => {
    const options = {
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${owner.token}`,
        [TENANT_HEADER]: tenant.id,
        'idempotency-key': randomUUID(),
      },
    } as const;

    return payload === undefined
      ? adapter.getInstance().inject(options)
      : adapter.getInstance().inject({ ...options, payload });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();

    db = app.get<Database>(DRIZZLE);
    usersService = app.get(UserService);
    passwords = app.get(PasswordService);
    memberships = app.get(MembershipService);

    const [created] = await db
      .insert(tenants)
      .values({ name: 'مستأجر آزمون Audit', slug: tenant.slug })
      .returning();
    tenant.id = created!.id;

    owner = await makeMember('OWNER');
    cashier = await makeMember('CASHIER');
  });

  afterAll(async () => {
    if (tenant.id !== '') {
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    }
    await app.close();
  });

  it('تغییر تنظیمات حساس را با actor و metadata ثبت می‌کند', async () => {
    const response = await authenticatedPost('/internal/dev/authz/sensitive-setting');

    expect(response.statusCode).toBe(200);

    const records = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction.select().from(auditLogs).where(eq(auditLogs.action, 'SETTINGS_CHANGED')),
    );
    const record = records[0];

    expect(record).toMatchObject({
      actorUserId: owner.id,
      entityType: 'tenant_settings',
      entityId: tenant.id,
      metadata: { source: 'dev-authz' },
    });
    expect(record?.ipAddress).not.toBeNull();
  });

  it('تغییر role و audit آن در یک عملیات ثبت می‌شوند', async () => {
    const response = await authenticatedPost(`/internal/dev/authz/members/${cashier.id}/role`, {
      roleCode: 'MANAGER',
    });

    expect(response.statusCode).toBe(200);

    const [members, records] = await withTenantTransaction(db, tenant.id, (transaction) =>
      Promise.all([
        transaction.select().from(tenantMemberships).where(eq(tenantMemberships.userId, cashier.id)),
        transaction.select().from(auditLogs).where(eq(auditLogs.action, 'ROLE_CHANGED')),
      ]),
    );
    const record = records[0];

    expect(members[0]?.roleCode).toBe('MANAGER');
    expect(record).toMatchObject({
      actorUserId: owner.id,
      entityType: 'tenant_membership',
      beforeData: { roleCode: 'CASHIER', userId: cashier.id },
      afterData: { roleCode: 'MANAGER', userId: cashier.id },
    });
  });

  it('runtime نمی‌تواند audit log را update یا delete کند', async () => {
    await authenticatedPost('/internal/dev/authz/sensitive-setting');
    const [record] = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction.select().from(auditLogs).limit(1),
    );

    expect(record).toBeDefined();

    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        transaction
          .update(auditLogs)
          .set({ action: 'TAMPERED' })
          .where(eq(auditLogs.id, record!.id)),
      ),
    ).rejects.toThrow();

    await expect(
      withTenantTransaction(db, tenant.id, (transaction) =>
        transaction.delete(auditLogs).where(eq(auditLogs.id, record!.id)),
      ),
    ).rejects.toThrow();
  });
});
