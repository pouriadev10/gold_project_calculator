import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/platform/auth/password.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import { auditLogs, parties, tenants } from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TENANT_HEADER } from '../src/platform/request-context/request-context.errors';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import type { Database } from '../src/platform/database/connect';
import type { RoleCode } from '../src/platform/database/schema';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const PASSWORD = 'رمز-عبور-اشخاص-۱۲۳';

interface TenantFixture {
  id: string;
  slug: string;
}

interface Member {
  id: string;
  token: string;
}

interface PartyResponse {
  id: string;
  type: 'CONSUMER' | 'BUSINESS';
  displayName: string;
  mobile: string | null;
  nationalId: string | null;
  linkedTenantId: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PartyPageResponse {
  items: PartyResponse[];
  total: number;
  limit: number;
  offset: number;
}

/** Party API with real PostgreSQL RLS, normalized search, and audited writes. */
describe('parties API (requires real PostgreSQL)', () => {
  const adapter = new FastifyAdapter();
  const tenantA: TenantFixture = { id: '', slug: `parties-api-a-${randomUUID().slice(0, 12)}` };
  const tenantB: TenantFixture = { id: '', slug: `parties-api-b-${randomUUID().slice(0, 12)}` };

  let app: NestFastifyApplication;
  let db: Database;
  let users: UserService;
  let passwords: PasswordService;
  let memberships: MembershipService;
  let partyService: PartiesService;
  let ownerA: Member;
  let ownerB: Member;
  let partyA: PartyResponse;
  let partyB: PartyResponse;

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

  async function createParty(
    member: Member,
    tenant: TenantFixture,
    payload: Record<string, unknown>,
    idempotencyKey = randomUUID(),
  ) {
    return adapter.getInstance().inject({
      method: 'POST',
      url: '/parties',
      headers: { ...headers(member, tenant), 'idempotency-key': idempotencyKey },
      payload,
    });
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
    partyService = app.get(PartiesService);

    for (const tenant of [tenantA, tenantB]) {
      const [created] = await db
        .insert(tenants)
        .values({ name: `مستأجر ${tenant.slug}`, slug: tenant.slug })
        .returning();
      tenant.id = created!.id;
    }

    ownerA = await makeMember(tenantA, 'OWNER');
    ownerB = await makeMember(tenantB, 'OWNER');
  });

  afterAll(async () => {
    if (tenantA.id !== '') {
      await db.delete(tenants).where(eq(tenants.id, tenantA.id));
    }
    if (tenantB.id !== '') {
      await db.delete(tenants).where(eq(tenants.id, tenantB.id));
    }
    await app?.close();
  });

  it('creates normalized parties, records safe audit evidence, and replays idempotent requests', async () => {
    const key = randomUUID();
    const payload = {
      type: 'CONSUMER',
      displayName: 'علي كريمي',
      mobile: '۰۹۱۲-۱۲۳-۴۵۶۷',
      nationalId: '۰۰۱-۲۳۴۵۶۷۸',
      notes: '  مشتری\u200cوفادار  ',
    };
    const first = await createParty(ownerA, tenantA, payload, key);
    const replay = await createParty(ownerA, tenantA, payload, key);

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    partyA = first.json<PartyResponse>();
    expect(replay.json<PartyResponse>().id).toBe(partyA.id);
    expect(partyA).toMatchObject({
      type: 'CONSUMER',
      displayName: 'علی کریمی',
      mobile: '0912-123-4567',
      nationalId: '001-2345678',
      status: 'ACTIVE',
      notes: 'مشتری‌وفادار',
    });

    const [stored, audits] = await withTenantTransaction(db, tenantA.id, (transaction) =>
      Promise.all([
        transaction.select().from(parties).where(eq(parties.id, partyA.id)),
        transaction
          .select()
          .from(auditLogs)
          .where(and(eq(auditLogs.entityId, partyA.id), eq(auditLogs.action, 'PARTY_CREATED'))),
      ]),
    );
    expect(stored[0]).toMatchObject({
      normalizedName: 'علی کریمی',
      normalizedMobile: '09121234567',
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: ownerA.id,
      entityType: 'party',
      afterData: expect.objectContaining({ hasMobile: true, hasNationalId: true }),
    });
    expect(audits[0]?.afterData).not.toHaveProperty('nationalId');
  });

  it('searches normalized Persian names and mobiles, and supports filters and pagination', async () => {
    const createdBusiness = await createParty(ownerA, tenantA, {
      type: 'BUSINESS',
      displayName: 'فروشگاه سکه',
      mobile: '0912 765 4321',
    });
    expect(createdBusiness.statusCode).toBe(201);
    const business = createdBusiness.json<PartyResponse>();

    const persianSearch = await adapter.getInstance().inject({
      method: 'GET',
      url: `/parties?search=${encodeURIComponent('علی‌کریمی')}`,
      headers: headers(ownerA, tenantA),
    });
    const mobileSearch = await adapter.getInstance().inject({
      method: 'GET',
      url: '/parties?search=0912-123',
      headers: headers(ownerA, tenantA),
    });
    const filtered = await adapter.getInstance().inject({
      method: 'GET',
      url: '/parties?type=BUSINESS&status=ACTIVE&limit=1&offset=0',
      headers: headers(ownerA, tenantA),
    });

    expect(persianSearch.statusCode).toBe(200);
    expect(persianSearch.json<PartyPageResponse>().items).toContainEqual(
      expect.objectContaining({ id: partyA.id }),
    );
    expect(mobileSearch.statusCode).toBe(200);
    expect(mobileSearch.json<PartyPageResponse>().items).toContainEqual(
      expect.objectContaining({ id: partyA.id }),
    );
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json<PartyPageResponse>()).toMatchObject({ limit: 1, offset: 0, total: 1 });
    expect(filtered.json<PartyPageResponse>().items).toEqual([
      expect.objectContaining({ id: business.id, type: 'BUSINESS', status: 'ACTIVE' }),
    ]);
  });

  it('enforces tenant isolation for list and direct identifier access', async () => {
    const create = await createParty(ownerB, tenantB, {
      type: 'CONSUMER',
      displayName: 'مشتری tenant دوم',
    });
    expect(create.statusCode).toBe(201);
    partyB = create.json<PartyResponse>();

    const foreignGet = await adapter.getInstance().inject({
      method: 'GET',
      url: `/parties/${partyB.id}`,
      headers: headers(ownerA, tenantA),
    });
    const listA = await adapter.getInstance().inject({
      method: 'GET',
      url: '/parties',
      headers: headers(ownerA, tenantA),
    });
    const foreignUpdate = await adapter.getInstance().inject({
      method: 'PATCH',
      url: `/parties/${partyB.id}`,
      headers: { ...headers(ownerA, tenantA), 'idempotency-key': randomUUID() },
      payload: { displayName: 'نباید تغییر کند' },
    });

    expect(foreignGet.statusCode).toBe(404);
    expect(listA.statusCode).toBe(200);
    expect(listA.json<PartyPageResponse>().items.map((party) => party.id)).not.toContain(partyB.id);
    expect(foreignUpdate.statusCode).toBe(404);
  });

  it('updates and deactivates without deleting, then excludes inactive parties from transaction selection', async () => {
    const update = await adapter.getInstance().inject({
      method: 'PATCH',
      url: `/parties/${partyA.id}`,
      headers: { ...headers(ownerA, tenantA), 'idempotency-key': randomUUID() },
      payload: { displayName: 'علی رضایی', mobile: null, notes: null },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json<PartyResponse>()).toMatchObject({
      id: partyA.id,
      displayName: 'علی رضایی',
      mobile: null,
      notes: null,
      status: 'ACTIVE',
    });

    const deactivate = await adapter.getInstance().inject({
      method: 'POST',
      url: `/parties/${partyA.id}/deactivate`,
      headers: { ...headers(ownerA, tenantA), 'idempotency-key': randomUUID() },
    });
    const activeList = await adapter.getInstance().inject({
      method: 'GET',
      url: '/parties?status=ACTIVE',
      headers: headers(ownerA, tenantA),
    });
    const stored = await partyService.findById(tenantA.id, partyA.id);
    const selectable = await partyService.findActive(tenantA.id, partyA.id);
    const audits = await withTenantTransaction(db, tenantA.id, (transaction) =>
      transaction
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.entityId, partyA.id)),
    );

    expect(deactivate.statusCode).toBe(200);
    expect(deactivate.json<PartyResponse>()).toMatchObject({ id: partyA.id, status: 'INACTIVE' });
    expect(stored).toMatchObject({ id: partyA.id, status: 'INACTIVE' });
    expect(selectable).toBeUndefined();
    expect(activeList.json<PartyPageResponse>().items.map((party) => party.id)).not.toContain(
      partyA.id,
    );
    expect(audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining(['PARTY_CREATED', 'PARTY_UPDATED', 'PARTY_DEACTIVATED']),
    );
  });
});
