import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generalSettingKeySchema } from '@gold/contracts';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/platform/auth/password.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import { auditLogs, tenants, versionedSettings } from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TENANT_HEADER } from '../src/platform/request-context/request-context.errors';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import type { GeneralSetting, GeneralSettings } from '@gold/contracts';
import type { Database } from '../src/platform/database/connect';
import type { RoleCode } from '../src/platform/database/schema';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const PASSWORD = 'رمز-عبور-تنظیمات-۱۲۳';
const URL = '/settings/general';

interface TenantFixture {
  id: string;
  slug: string;
}

interface Member {
  id: string;
  token: string;
}

/** `GET`/`POST /settings/general` روی PostgreSQL واقعی — M-13، مسئله‌ی شناخته‌شده #19. */
describe('general settings API (requires real PostgreSQL)', () => {
  const adapter = new FastifyAdapter();
  const tenantA: TenantFixture = { id: '', slug: `settings-a-${randomUUID().slice(0, 12)}` };
  const tenantB: TenantFixture = { id: '', slug: `settings-b-${randomUUID().slice(0, 12)}` };

  let app: NestFastifyApplication;
  let db: Database;
  let users: UserService;
  let passwords: PasswordService;
  let memberships: MembershipService;
  const members: Partial<Record<'ownerA' | 'managerA' | 'cashierA' | 'ownerB', Member>> = {};

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

  function member(name: keyof typeof members): Member {
    const found = members[name];
    if (found === undefined) throw new Error(`member ${name} was not created`);
    return found;
  }

  function headers(who: Member, tenant: TenantFixture, idempotencyKey?: string): Record<string, string> {
    return {
      authorization: `Bearer ${who.token}`,
      [TENANT_HEADER]: tenant.id,
      ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }),
    };
  }

  const list = (who: Member, tenant: TenantFixture) =>
    adapter.getInstance().inject({ method: 'GET', url: URL, headers: headers(who, tenant) });

  /** `key: null` یعنی درخواست بدون Idempotency-Key. */
  const update = (who: Member, tenant: TenantFixture, payload: unknown, key: string | null = randomUUID()) =>
    adapter
      .getInstance()
      .inject({ method: 'POST', url: URL, headers: headers(who, tenant, key ?? undefined), payload });

  const valueOf = (settings: GeneralSettings, key: GeneralSetting['key']) =>
    settings.settings.find((setting) => setting.key === key);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();

    db = app.get<Database>(DRIZZLE);
    users = app.get(UserService);
    passwords = app.get(PasswordService);
    memberships = app.get(MembershipService);
    const tenantService = app.get(TenantService);

    // TenantService تنظیمات اولیه را در همان تراکنش ساخت مستأجر seed می‌کند.
    for (const tenant of [tenantA, tenantB]) {
      tenant.id = (await tenantService.create({ name: `مستأجر ${tenant.slug}`, slug: tenant.slug })).id;
    }
    members.ownerA = await makeMember(tenantA, 'OWNER');
    members.managerA = await makeMember(tenantA, 'MANAGER');
    members.cashierA = await makeMember(tenantA, 'CASHIER');
    members.ownerB = await makeMember(tenantB, 'OWNER');
  });

  afterAll(async () => {
    for (const tenant of [tenantA, tenantB]) {
      if (tenant.id !== '') await db.delete(tenants).where(eq(tenants.id, tenant.id));
    }
    await app?.close();
  });

  it('هر سه نقش شش تنظیم seed ِ نسخه‌ی ۱ را به ترتیب قرارداد می‌خوانند', async () => {
    for (const who of [member('ownerA'), member('managerA'), member('cashierA')]) {
      const response = await list(who, tenantA);
      expect(response.statusCode).toBe(200);
      const body = response.json<GeneralSettings>();
      expect(body.settings.map((setting) => setting.key)).toEqual(generalSettingKeySchema.options);
      expect(body.settings.every((setting) => setting.version === 1 && setting.createdBy === null)).toBe(true);
    }
    const body = (await list(member('cashierA'), tenantA)).json<GeneralSettings>();
    expect(valueOf(body, 'purchase.second_hand_default_karat')?.value).toBe('740');
    expect(valueOf(body, 'pricing.rounding_policy')?.value).toBe('HALF_UP');
  });

  it('نسخه‌ی تازه با مقدار متعارف می‌سازد، نسخه‌ی قبلی را می‌بندد، audit می‌کند و تکرار کلید را replay می‌کند', async () => {
    const key = randomUUID();
    const first = await update(member('managerA'), tenantA, { key: 'pricing.rial_rounding_unit', value: '05000' }, key);
    expect(first.statusCode).toBe(201);
    const created = first.json<GeneralSetting>();
    expect(created).toMatchObject({
      key: 'pricing.rial_rounding_unit',
      value: '5000',
      version: 2,
      createdBy: member('managerA').id,
    });

    const replay = await update(member('managerA'), tenantA, { key: 'pricing.rial_rounding_unit', value: '05000' }, key);
    expect(replay.statusCode).toBe(201);
    expect(replay.json<GeneralSetting>()).toEqual(created);

    const effective = valueOf((await list(member('cashierA'), tenantA)).json<GeneralSettings>(), 'pricing.rial_rounding_unit');
    expect(effective).toMatchObject({ value: '5000', version: 2 });

    const rows = await withTenantTransaction(db, tenantA.id, (transaction) =>
      transaction
        .select()
        .from(versionedSettings)
        .where(
          and(
            eq(versionedSettings.tenantId, tenantA.id),
            eq(versionedSettings.settingKey, 'pricing.rial_rounding_unit'),
          ),
        )
        .orderBy(asc(versionedSettings.version)),
    );
    // replay نسخه‌ی سوم نساخت؛ نسخه‌ی ۱ دست‌نخورده و فقط بسته شد.
    expect(rows.map((row) => row.version)).toEqual([1, 2]);
    expect(rows[0]!.valueJson).toEqual({ value: '1000' });
    expect(rows[0]!.validTo?.toISOString()).toBe(created.validFrom);
    expect(rows[1]!.validTo).toBeNull();

    const audits = await withTenantTransaction(db, tenantA.id, (transaction) =>
      transaction
        .select({ actorUserId: auditLogs.actorUserId })
        .from(auditLogs)
        .where(and(eq(auditLogs.tenantId, tenantA.id), eq(auditLogs.entityId, rows[1]!.id))),
    );
    expect(audits).toEqual([{ actorUserId: member('managerA').id }]);
  });

  it('صندوقدار نمی‌تواند تغییر دهد؛ کلید idempotency و مقدار معتبر الزامی است', async () => {
    const before = (await list(member('ownerA'), tenantA)).json<GeneralSettings>();

    const cashier = await update(member('cashierA'), tenantA, { key: 'sales.invoice_correction_window_minutes', value: '60' });
    expect(cashier.statusCode).toBe(403);

    const missingKey = await update(
      member('ownerA'),
      tenantA,
      { key: 'sales.invoice_correction_window_minutes', value: '60' },
      null,
    );
    expect(missingKey.statusCode).toBe(400);

    const invalid = await update(member('ownerA'), tenantA, { key: 'purchase.second_hand_default_karat', value: '1200' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json<{ error: { fields: Record<string, string[]> } }>().error.fields['value']).toEqual([
      'عیار باید بین ۱ و ۱۰۰۰ باشد',
    ]);

    const unknown = await update(member('ownerA'), tenantA, { key: 'pricing.base_quote_karat', value: '750' });
    expect(unknown.statusCode).toBe(400);

    expect((await list(member('ownerA'), tenantA)).json<GeneralSettings>()).toEqual(before);
  });

  it('تغییر مستأجر دیگر روی مقدار این مستأجر اثری ندارد', async () => {
    const before = valueOf((await list(member('ownerA'), tenantA)).json<GeneralSettings>(), 'purchase.second_hand_default_karat');

    const other = await update(member('ownerB'), tenantB, { key: 'purchase.second_hand_default_karat', value: '730' });
    expect(other.statusCode).toBe(201);

    expect(valueOf((await list(member('ownerB'), tenantB)).json<GeneralSettings>(), 'purchase.second_hand_default_karat')?.value).toBe('730');
    expect(valueOf((await list(member('ownerA'), tenantA)).json<GeneralSettings>(), 'purchase.second_hand_default_karat')).toEqual(before);
  });
});
