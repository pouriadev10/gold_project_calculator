import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/platform/auth/password.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import { auditLogs, priceQuotes, tenants } from '../src/platform/database/schema';
import { TENANT_HEADER } from '../src/platform/request-context/request-context.errors';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { MembershipService } from '../src/platform/users/membership.service';
import { UserService } from '../src/platform/users/user.service';
import type { Database } from '../src/platform/database/connect';
import type { RoleCode } from '../src/platform/database/schema';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const PASSWORD = 'رمز-عبور-مظنه-۱۲۳';
const MANUAL_QUOTE_URL = '/pricing/quotes/manual';

interface TenantFixture {
  id: string;
  slug: string;
}

interface Member {
  id: string;
  token: string;
}

interface PriceQuoteResponse {
  id: string;
  quoteType: 'MAZNEH';
  amountRial: string;
  source: 'MANUAL' | 'FEED';
  observedAt: string;
  createdBy: string | null;
  createdAt: string;
}

/** Manual quote API with real PostgreSQL RLS and immutable quote records. */
describe('manual price quotes (requires real PostgreSQL)', () => {
  const adapter = new FastifyAdapter();
  const tenantA: TenantFixture = { id: '', slug: `quotes-a-${randomUUID().slice(0, 12)}` };
  const tenantB: TenantFixture = { id: '', slug: `quotes-b-${randomUUID().slice(0, 12)}` };

  let app: NestFastifyApplication;
  let db: Database;
  let users: UserService;
  let passwords: PasswordService;
  let memberships: MembershipService;
  let ownerA: Member;
  let ownerB: Member;
  let cashierA: Member;

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
    return {
      authorization: `Bearer ${member.token}`,
      [TENANT_HEADER]: tenant.id,
    };
  }

  async function createManualQuote(
    member: Member,
    tenant: TenantFixture,
    amountRial: string,
    idempotencyKey = randomUUID(),
  ) {
    return adapter.getInstance().inject({
      method: 'POST',
      url: MANUAL_QUOTE_URL,
      headers: { ...headers(member, tenant), 'idempotency-key': idempotencyKey },
      payload: { quoteType: 'MAZNEH', amountRial },
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
    if (tenantA.id !== '') {
      await db.delete(tenants).where(eq(tenants.id, tenantA.id));
    }
    if (tenantB.id !== '') {
      await db.delete(tenants).where(eq(tenants.id, tenantB.id));
    }
    await app?.close();
  });

  it('creates a manual quote as a bigint-backed integer string and writes audit evidence', async () => {
    const response = await createManualQuote(ownerA, tenantA, '9007199254740993');

    expect(response.statusCode).toBe(201);
    const created = response.json<PriceQuoteResponse>();
    expect(created).toMatchObject({
      quoteType: 'MAZNEH',
      amountRial: '9007199254740993',
      source: 'MANUAL',
      createdBy: ownerA.id,
    });
    expect(new Date(created.observedAt).toISOString()).toBe(created.observedAt);

    const [stored, audit] = await withTenantTransaction(db, tenantA.id, (transaction) =>
      Promise.all([
        transaction.select().from(priceQuotes).where(eq(priceQuotes.id, created.id)),
        transaction
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.action, 'PRICE_QUOTE_MANUAL_CREATED')),
      ]),
    );
    expect(stored[0]).toMatchObject({ amountRial: 9007199254740993n, source: 'MANUAL' });
    expect(audit).toContainEqual(
      expect.objectContaining({
        actorUserId: ownerA.id,
        entityType: 'price_quote',
        entityId: created.id,
        afterData: expect.objectContaining({ amountRial: '9007199254740993', source: 'MANUAL' }),
      }),
    );
  });

  it('returns the latest quote by observed_at and returns the tenant history', async () => {
    const oldObservedAt = new Date('2025-01-01T00:00:00.000Z');
    const newestObservedAt = new Date('2030-01-01T00:00:00.000Z');
    const [oldQuote, newestQuote] = await withTenantTransaction(db, tenantA.id, async (transaction) => {
      const [oldCreated] = await transaction
        .insert(priceQuotes)
        .values({
          tenantId: tenantA.id,
          quoteType: 'MAZNEH',
          amountRial: 11n,
          source: 'MANUAL',
          observedAt: oldObservedAt,
          createdBy: ownerA.id,
        })
        .returning();
      const [newestCreated] = await transaction
        .insert(priceQuotes)
        .values({
          tenantId: tenantA.id,
          quoteType: 'MAZNEH',
          amountRial: 22n,
          source: 'MANUAL',
          observedAt: newestObservedAt,
          createdBy: ownerA.id,
        })
        .returning();

      return [oldCreated!, newestCreated!] as const;
    });

    const latest = await adapter.getInstance().inject({
      method: 'GET',
      url: '/pricing/quotes/latest?quoteType=MAZNEH',
      headers: headers(ownerA, tenantA),
    });
    const history = await adapter.getInstance().inject({
      method: 'GET',
      url: '/pricing/quotes?quoteType=MAZNEH',
      headers: headers(ownerA, tenantA),
    });

    expect(latest.statusCode).toBe(200);
    expect(latest.json<PriceQuoteResponse>()).toMatchObject({
      id: newestQuote.id,
      amountRial: '22',
      observedAt: newestObservedAt.toISOString(),
    });
    expect(history.statusCode).toBe(200);
    const historyBody = history.json<PriceQuoteResponse[]>();
    expect(historyBody.map((quote) => quote.id)).toEqual(
      expect.arrayContaining([oldQuote.id, newestQuote.id]),
    );
    expect(historyBody.indexOf(historyBody.find((quote) => quote.id === newestQuote.id)!)).toBeLessThan(
      historyBody.indexOf(historyBody.find((quote) => quote.id === oldQuote.id)!),
    );
  });

  it('does not expose one tenant quote history to another tenant', async () => {
    const create = await createManualQuote(ownerB, tenantB, '987654321');
    expect(create.statusCode).toBe(201);
    const tenantBQuote = create.json<PriceQuoteResponse>();

    const tenantAHistory = await adapter.getInstance().inject({
      method: 'GET',
      url: '/pricing/quotes',
      headers: headers(ownerA, tenantA),
    });
    const tenantBHistory = await adapter.getInstance().inject({
      method: 'GET',
      url: '/pricing/quotes',
      headers: headers(ownerB, tenantB),
    });

    expect(tenantAHistory.statusCode).toBe(200);
    expect(tenantAHistory.json<PriceQuoteResponse[]>().map((quote) => quote.id)).not.toContain(
      tenantBQuote.id,
    );
    expect(tenantBHistory.statusCode).toBe(200);
    expect(tenantBHistory.json<PriceQuoteResponse[]>()).toContainEqual(
      expect.objectContaining({ id: tenantBQuote.id, amountRial: '987654321' }),
    );
  });

  it('rejects decimal, zero, out-of-range, and unauthorized manual values before they reach the database', async () => {
    const decimal = await createManualQuote(ownerA, tenantA, '123.45');
    const zero = await createManualQuote(ownerA, tenantA, '0');
    const outOfRange = await createManualQuote(ownerA, tenantA, '9223372036854775808');
    const cashier = await createManualQuote(cashierA, tenantA, '12345');

    expect(decimal.statusCode).toBe(400);
    expect(zero.statusCode).toBe(400);
    expect(outOfRange.statusCode).toBe(400);
    expect(cashier.statusCode).toBe(403);
  });

  it('replays the same idempotency key without adding a second quote', async () => {
    const key = randomUUID();
    const first = await createManualQuote(ownerA, tenantA, '314159265', key);
    const replay = await createManualQuote(ownerA, tenantA, '314159265', key);

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json<PriceQuoteResponse>().id).toBe(first.json<PriceQuoteResponse>().id);
  });

  it('prevents runtime mutation and deletion of price quote evidence', async () => {
    const created = await createManualQuote(ownerA, tenantA, '271828182');
    expect(created.statusCode).toBe(201);
    const quote = created.json<PriceQuoteResponse>();

    await expect(
      withTenantTransaction(db, tenantA.id, (transaction) =>
        transaction
          .update(priceQuotes)
          .set({ amountRial: 1n })
          .where(eq(priceQuotes.id, quote.id)),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantTransaction(db, tenantA.id, (transaction) =>
        transaction.delete(priceQuotes).where(eq(priceQuotes.id, quote.id)),
      ),
    ).rejects.toThrow();
  });
});
