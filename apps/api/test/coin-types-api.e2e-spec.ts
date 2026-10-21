import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/platform/auth/password.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import { tenants } from '../src/platform/database/schema';
import { TENANT_HEADER } from '../src/platform/request-context/request-context.errors';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import type { CoinTypeCatalog, CoinTypeVersion } from '@gold/contracts';
import type { Database } from '../src/platform/database/connect';
import type { RoleCode } from '../src/platform/database/schema';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const PASSWORD = 'رمز-عبور-انواع-سکه-۱۲۳';
const URL = '/inventory/coin-types';

interface Member {
  id: string;
  token: string;
}

/** API ِ انواع سکه روی PostgreSQL واقعی — M-14، مسئله‌ی شناخته‌شده #22. */
describe('coin types API (requires real PostgreSQL)', () => {
  const adapter = new FastifyAdapter();
  const tenant = { id: '', slug: `coin-api-${randomUUID().slice(0, 12)}` };

  let app: NestFastifyApplication;
  let db: Database;
  let owner: Member;
  let cashier: Member;

  async function makeMember(role: RoleCode): Promise<Member> {
    const users = app.get(UserService);
    const user = await users.create({
      email: `${randomUUID().slice(0, 12)}@example.com`,
      displayName: `کاربر ${role}`,
    });
    await users.setPasswordHash(user.id, await app.get(PasswordService).hash(PASSWORD));
    await app.get(MembershipService).add(tenant.id, { userId: user.id, roleCode: role });
    const login = await adapter.getInstance().inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password: PASSWORD, tenantSlug: tenant.slug },
    });
    expect(login.statusCode).toBe(200);
    return { id: user.id, token: login.json<{ accessToken: string }>().accessToken };
  }

  function request(who: Member, method: 'GET' | 'POST', url: string, payload?: unknown, key: string | null = randomUUID()) {
    return adapter.getInstance().inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${who.token}`,
        [TENANT_HEADER]: tenant.id,
        ...(method === 'POST' && key !== null ? { 'idempotency-key': key } : {}),
      },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  async function seeded(code: string): Promise<CoinTypeVersion> {
    const list = (await request(cashier, 'GET', URL)).json<CoinTypeVersion[]>();
    const found = list.find((coin) => coin.code === code);
    if (found === undefined) throw new Error(`seeded coin ${code} is missing`);
    return found;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();
    db = app.get<Database>(DRIZZLE);

    // ساخت مستأجر انواع سکه‌ی پایه را seed می‌کند.
    tenant.id = (await app.get(TenantService).create({ name: 'مستأجر انواع سکه', slug: tenant.slug })).id;
    owner = await makeMember('OWNER');
    cashier = await makeMember('CASHIER');
  });

  afterAll(async () => {
    if (tenant.id !== '') await db.delete(tenants).where(eq(tenants.id, tenant.id));
    await app?.close();
  });

  it('هر نقش انواع seed شده را با وزن میکروگرمی رشته‌ای و پرچم بانک مرکزی می‌خواند', async () => {
    const list = await request(cashier, 'GET', URL);
    expect(list.statusCode).toBe(200);
    expect(list.json<CoinTypeVersion[]>().map((coin) => coin.code).sort()).toEqual(
      ['BAHAR_AZADI_NEW', 'GERAMI', 'NIM_BAHAR_AZADI', 'ROB_BAHAR_AZADI'],
    );
    expect(await seeded('BAHAR_AZADI_NEW')).toMatchObject({
      grossWeightUg: '8133000',
      karat: 900,
      mintType: 'CENTRAL_BANK',
      isCentralBankMinted: true,
      version: 1,
      active: true,
    });

    const history = await request(cashier, 'GET', `${URL}/history`);
    expect(history.statusCode).toBe(200);
    expect(history.json<CoinTypeCatalog>().types).toHaveLength(4);
  });

  it('نوع تازه می‌سازد؛ کد تکراری ۴۰۹، صندوقدار ۴۰۳ و درخواست بی‌کلید ۴۰۰ است', async () => {
    const body = {
      code: `FOREIGN_${randomUUID().slice(0, 6)}`,
      title: 'سکه‌ی خارجی',
      mintType: 'PRIVATE_MINT',
      grossWeightUg: '7988000',
      karat: 916,
      active: true,
    };
    const created = await request(owner, 'POST', URL, body);
    expect(created.statusCode).toBe(201);
    // پرچم بانک مرکزی را سرور از mintType می‌سازد؛ سکه‌ی غیر بانک مرکزی حباب ندارد.
    expect(created.json<CoinTypeVersion>()).toMatchObject({
      code: body.code,
      mintType: 'PRIVATE_MINT',
      isCentralBankMinted: false,
      version: 1,
    });

    expect((await request(owner, 'POST', URL, body)).statusCode).toBe(409);
    expect((await request(cashier, 'POST', URL, { ...body, code: 'CASHIER_COIN' })).statusCode).toBe(403);
    expect((await request(owner, 'POST', URL, { ...body, code: 'NO_KEY' }, null)).statusCode).toBe(400);
    expect(
      (await request(owner, 'POST', URL, { ...body, code: 'CLAIMS_BUBBLE', isCentralBankMinted: true })).statusCode,
    ).toBe(400);
  });

  it('نسخه‌ی تازه نسخه‌ی قبلی را می‌بندد و مشخصات قبلی را برای سندهای گذشته نگه می‌دارد', async () => {
    const gerami = await seeded('GERAMI');
    const next = await request(owner, 'POST', `${URL}/${gerami.coinTypeId}/versions`, {
      title: gerami.title,
      mintType: 'CENTRAL_BANK',
      grossWeightUg: '1016700',
      karat: 900,
      active: true,
    });
    expect(next.statusCode).toBe(201);
    const created = next.json<CoinTypeVersion>();
    expect(created).toMatchObject({ coinTypeId: gerami.coinTypeId, version: 2, grossWeightUg: '1016700' });

    const history = (await request(cashier, 'GET', `${URL}/history`)).json<CoinTypeCatalog>();
    const versions = history.types.find((type) => type.coinTypeId === gerami.coinTypeId)!.versions;
    expect(versions.map((version) => version.version)).toEqual([2, 1]);
    expect(versions[1]).toMatchObject({ grossWeightUg: '1016600', validTo: created.validFrom });

    expect((await request(owner, 'POST', `${URL}/${randomUUID()}/versions`, {
      title: 'ناموجود',
      mintType: 'OTHER',
      grossWeightUg: '1',
      karat: 1,
      active: true,
    })).statusCode).toBe(404);
  });

  it('فروش نوع سکه‌ی غیرفعال رد ِ کسب‌وکار (۴۲۲) است، نه خطای غیرمنتظره', async () => {
    const rob = await seeded('ROB_BAHAR_AZADI');
    const deactivated = await request(owner, 'POST', `${URL}/${rob.coinTypeId}/versions`, {
      title: rob.title,
      mintType: 'CENTRAL_BANK',
      grossWeightUg: rob.grossWeightUg,
      karat: rob.karat,
      active: false,
    });
    expect(deactivated.statusCode).toBe(201);
    expect((await seeded('ROB_BAHAR_AZADI')).active).toBe(false);

    const party = await request(owner, 'POST', '/parties', { type: 'CONSUMER', displayName: 'خریدار سکه' });
    expect(party.statusCode).toBe(201);
    const quote = await request(owner, 'POST', '/pricing/quotes/manual', {
      quoteType: 'MAZNEH',
      amountRial: '400000000',
    });
    expect(quote.statusCode).toBe(201);

    const sale = await request(cashier, 'POST', '/sales/invoices/coins', {
      partyId: party.json<{ id: string }>().id,
      coinTypeId: rob.coinTypeId,
      count: 1,
      marketUnitPriceRial: '250000000',
      quoteId: quote.json<{ id: string }>().id,
      effectiveAt: new Date().toISOString(),
      paidRial: '250000000',
    });
    expect(sale.statusCode).toBe(422);
    expect(sale.json<{ error: { code: string } }>().error.code).toBe('BUSINESS_RULE_VIOLATION');
  });
});
