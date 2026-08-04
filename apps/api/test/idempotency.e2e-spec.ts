import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/platform/database/database.module';
import { idempotencyRecords, rlsProbes, tenants } from '../src/platform/database/schema';
import { TENANT_HEADER } from '../src/platform/request-context/request-context.errors';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
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

  it('استفاده از key قبلی برای درخواست متفاوت conflict می‌دهد', async () => {
    const key = randomUUID();
    const first = await callProbe(key, `first-${randomUUID()}`);
    const second = await callProbe(key, `different-${randomUUID()}`);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
  });
});
