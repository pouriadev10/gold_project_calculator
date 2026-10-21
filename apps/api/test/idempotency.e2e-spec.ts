import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/platform/database/database.module';
import { idempotencyRecords, rlsProbes, tenants } from '../src/platform/database/schema';
import { TENANT_HEADER } from '../src/platform/request-context/request-context.errors';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { IdempotencyService } from '../src/platform/idempotency/idempotency.service';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Database } from '../src/platform/database/connect';

interface ProbeResponse {
  readonly id: string;
  readonly note: string;
}

/**
 * Idempotency واقعی با PostgreSQL — نه mock. دو inject هم‌زمان به دو connection
 * جدا می‌رسند و unique constraint دیتابیس باید فقط به یکی اجازه‌ی اجرای callback بدهد.
 */
describe('Idempotency-Key (نیازمند PostgreSQL واقعی)', () => {
  const adapter = new FastifyAdapter();
  const tenant = { id: '', slug: `idempotency-${randomUUID().slice(0, 12)}` };

  let app: NestFastifyApplication;
  let db: Database;

  const callProbe = (key: string | undefined, note: string) => {
    const headers =
      key === undefined
        ? { [TENANT_HEADER]: tenant.id }
        : { [TENANT_HEADER]: tenant.id, 'idempotency-key': key };

    return adapter.getInstance().inject({
      method: 'POST',
      url: '/internal/dev/idempotency/probe',
      headers,
      payload: { note },
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();
    db = app.get<Database>(DRIZZLE);

    const [created] = await db
      .insert(tenants)
      .values({ name: 'مستأجر آزمون Idempotency', slug: tenant.slug })
      .returning();
    tenant.id = created!.id;
  });

  afterAll(async () => {
    if (tenant.id !== '') {
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    }
    await app.close();
  });

  it('درخواست نوشتنی بدون Idempotency-Key رد می‌شود', async () => {
    const response = await callProbe(undefined, `no-key-${randomUUID()}`);

    expect(response.statusCode).toBe(400);
  });

  it('تکرار هم‌زمان یک request فقط یک اثر و یک پاسخ ایجاد می‌کند', async () => {
    const key = randomUUID();
    const note = `concurrent-${randomUUID()}`;
    const [first, second] = await Promise.all([callProbe(key, note), callProbe(key, note)]);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const firstBody = first.json<ProbeResponse>();
    const secondBody = second.json<ProbeResponse>();
    expect(secondBody).toEqual(firstBody);

    const [effects, records] = await withTenantTransaction(db, tenant.id, async (transaction) =>
      Promise.all([
        transaction.select().from(rlsProbes).where(eq(rlsProbes.note, note)),
        transaction.select().from(idempotencyRecords).where(eq(idempotencyRecords.key, key)),
      ]),
    );

    expect(effects).toHaveLength(1);
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe('COMPLETED');
    expect(records[0]?.responseBody).toEqual(firstBody);
  });

  it('M-08: با pool ِ گرم هم شش تکرار هم‌زمان فقط یک اثر دارند و همه همان پاسخ را می‌گیرند', async () => {
    // pool ِ سرد درخواست‌ها را پشت handshake ِ اتصال تازه سری می‌کرد و مسابقه دیده نمی‌شد (M-07).
    await Promise.all(Array.from({ length: 10 }, () => db.execute(sql`SELECT pg_sleep(0.05)`)));
    const key = randomUUID();
    const note = `warm-${randomUUID()}`;
    const responses = await Promise.all(Array.from({ length: 6 }, () => callProbe(key, note)));

    expect(responses.map((response) => response.statusCode)).toEqual([201, 201, 201, 201, 201, 201]);
    expect(new Set(responses.map((response) => response.json<ProbeResponse>().id)).size).toBe(1);
    const effects = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction.select().from(rlsProbes).where(eq(rlsProbes.note, note)),
    );
    expect(effects).toHaveLength(1);
  });

  it('M-08: اجرای شکست‌خورده کلید را مصرف نمی‌کند و تلاش دوباره واقعاً اجرا می‌شود', async () => {
    const idempotency = app.get(IdempotencyService);
    const key = randomUUID();
    const note = `retry-${randomUUID()}`;
    const request = { method: 'POST', path: '/m08/retry', body: { note } };
    const write = (fail: boolean) =>
      idempotency.execute({
        tenantId: tenant.id,
        key,
        request,
        execute: async (transaction) => {
          await transaction.insert(rlsProbes).values({ tenantId: tenant.id, note });
          if (fail) throw new Error('شکست میانه‌ی سند');
          return { status: 201, body: { ok: true } };
        },
      });

    await expect(write(true)).rejects.toThrow('شکست میانه‌ی سند');
    const second = await write(false);
    const third = await write(false);

    expect(second.replayed).toBe(false);
    expect(third.replayed).toBe(true);
    const effects = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction.select().from(rlsProbes).where(eq(rlsProbes.note, note)),
    );
    expect(effects).toHaveLength(1);
  });

  it('M-08: کلید منقضی دوباره قابل استفاده است، ولی کلید زنده با بدنه‌ی دیگر conflict می‌ماند', async () => {
    const idempotency = app.get(IdempotencyService);
    const key = randomUUID();
    await db.insert(idempotencyRecords).values({
      tenantId: tenant.id,
      key,
      requestHash: 'stale-hash',
      status: 'COMPLETED',
      responseStatus: 201,
      responseBody: { stale: true },
      expiresAt: new Date(Date.now() - 60_000),
    });

    const fresh = await idempotency.execute({
      tenantId: tenant.id,
      key,
      request: { method: 'POST', path: '/m08/expired', body: { n: 1 } },
      execute: async () => ({ status: 201, body: { fresh: true } }),
    });
    expect(fresh).toEqual({ replayed: false, response: { status: 201, body: { fresh: true } } });

    await expect(
      idempotency.execute({
        tenantId: tenant.id,
        key,
        request: { method: 'POST', path: '/m08/expired', body: { n: 2 } },
        execute: async () => ({ status: 201, body: { never: true } }),
      }),
    ).rejects.toThrow('قبلاً برای درخواست دیگری');
  });

  it('استفاده از key قبلی برای درخواست متفاوت conflict می‌دهد', async () => {
    const key = randomUUID();
    const first = await callProbe(key, `first-${randomUUID()}`);
    const second = await callProbe(key, `different-${randomUUID()}`);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
  });
});
