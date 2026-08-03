import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/platform/database/database.module';
import { tenants } from '../src/platform/database/schema';
import { TENANT_HEADER } from '../src/platform/request-context/request-context.errors';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Database } from '../src/platform/database/connect';

interface ContextBody {
  tenantId: string;
  tenantSlug: string;
  userId: string | null;
  slugAfterAwait: string | null;
}

/**
 * context مستأجر از مسیر واقعی HTTP — BE-008.
 * نیازمند PostgreSQL واقعی (BE-006).
 */
describe('context مستأجر (نیازمند PostgreSQL واقعی)', () => {
  const adapter = new FastifyAdapter();

  let app: NestFastifyApplication;

  /** مستأجرهای واقعی که تست‌ها با آن‌ها کار می‌کنند. */
  const created: { id: string; slug: string }[] = [];
  let suspendedTenantId: string;

  const makeTenant = async (): Promise<{ id: string; slug: string }> => {
    const slug = `ctx-${randomUUID().slice(0, 12)}`;
    const response = await adapter.getInstance().inject({
      method: 'POST',
      url: '/internal/dev/tenants',
      payload: { name: `مستأجر ${slug}`, slug },
    });

    expect(response.statusCode).toBe(201);
    return { id: response.json<{ id: string }>().id, slug };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();

    for (let index = 0; index < 3; index += 1) {
      created.push(await makeTenant());
    }

    // یک مستأجر معلق، مستقیم در دیتابیس — endpoint تغییر وضعیت نداریم.
    const suspended = await makeTenant();
    suspendedTenantId = suspended.id;

    const db = app.get<Database>(DRIZZLE);
    await db.update(tenants).set({ status: 'SUSPENDED' }).where(eq(tenants.id, suspendedTenantId));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('رد کردن درخواست بدون مستأجر معتبر', () => {
    it('بدون هدر ۴۰۰ می‌دهد', async () => {
      const response = await adapter
        .getInstance()
        .inject({ method: 'GET', url: '/internal/dev/context' });

      expect(response.statusCode).toBe(400);
    });

    it('هدر بدشکل ۴۰۰ می‌دهد', async () => {
      const response = await adapter.getInstance().inject({
        method: 'GET',
        url: '/internal/dev/context',
        headers: { [TENANT_HEADER]: 'not-a-uuid' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('مستأجر ناموجود ۴۰۴ می‌دهد', async () => {
      const response = await adapter.getInstance().inject({
        method: 'GET',
        url: '/internal/dev/context',
        headers: { [TENANT_HEADER]: randomUUID() },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('مسیرهای عمومی', () => {
    it('/health بدون هدر مستأجر کار می‌کند', async () => {
      const response = await adapter.getInstance().inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    });

    it('ساخت مستأجر بدون هدر مستأجر ممکن است — وگرنه بن‌بست بود', async () => {
      const response = await adapter.getInstance().inject({
        method: 'POST',
        url: '/internal/dev/tenants',
        payload: { name: 'بدون هدر', slug: `nh-${randomUUID().slice(0, 12)}` },
      });

      expect(response.statusCode).toBe(201);
    });
  });

  describe('مستأجر معلق', () => {
    it('می‌تواند بخواند', async () => {
      const response = await adapter.getInstance().inject({
        method: 'GET',
        url: '/internal/dev/context',
        headers: { [TENANT_HEADER]: suspendedTenantId },
      });

      expect(response.statusCode).toBe(200);
    });

    it('نمی‌تواند بنویسد — ۴۰۳', async () => {
      const response = await adapter.getInstance().inject({
        method: 'POST',
        url: '/internal/dev/context',
        headers: { [TENANT_HEADER]: suspendedTenantId },
        payload: {},
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('context در دسترس handler است', () => {
    it('مستأجر هدر را برمی‌گرداند و از مرز await رد می‌شود', async () => {
      const tenant = created[0]!;

      const response = await adapter.getInstance().inject({
        method: 'GET',
        url: '/internal/dev/context',
        headers: { [TENANT_HEADER]: tenant.id },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json<ContextBody>();

      expect(body.tenantId).toBe(tenant.id);
      expect(body.tenantSlug).toBe(tenant.slug);
      // پس از رفت‌وبرگشت دیتابیس همچنان همان مستأجر است.
      expect(body.slugAfterAwait).toBe(tenant.slug);
      expect(body.userId).toBeNull();
    });
  });

  describe('جداسازی درخواست‌های هم‌زمان', () => {
    it('سه مستأجر متفاوت به‌طور هم‌زمان context یکدیگر را نمی‌بینند', async () => {
      const responses = await Promise.all(
        created.map((tenant) =>
          adapter.getInstance().inject({
            method: 'GET',
            url: '/internal/dev/context',
            headers: { [TENANT_HEADER]: tenant.id },
          }),
        ),
      );

      responses.forEach((response, index) => {
        const expected = created[index]!;
        const body = response.json<ContextBody>();

        expect(body.tenantId).toBe(expected.id);
        expect(body.slugAfterAwait).toBe(expected.slug);
      });
    });

    it('سی درخواست درهم‌بافته هر کدام دقیقاً مستأجر خودشان را می‌بینند', async () => {
      const plan = Array.from({ length: 30 }, (_unused, index) => created[index % created.length]!);

      const responses = await Promise.all(
        plan.map((tenant) =>
          adapter.getInstance().inject({
            method: 'GET',
            url: '/internal/dev/context',
            headers: { [TENANT_HEADER]: tenant.id },
          }),
        ),
      );

      const seen = responses.map((response) => response.json<ContextBody>().slugAfterAwait);

      expect(seen).toEqual(plan.map((tenant) => tenant.slug));
    });
  });
});
