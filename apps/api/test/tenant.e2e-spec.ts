import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DEFAULT_TENANT_TIMEZONE } from '../src/platform/database/schema';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * endpointهای موقت مستأجر — BE-007. نیازمند PostgreSQL واقعی (BE-006).
 *
 * slug هر تست تصادفی است تا اجراهای پشت‌سرهم روی همان دیتابیس به هم
 * نخورند؛ این تست‌ها عمداً چیزی را پاک نمی‌کنند تا رفتار یکتایی در طول
 * زمان هم واقعی بماند.
 */
describe('endpointهای توسعه‌ی مستأجر (نیازمند PostgreSQL واقعی)', () => {
  let app: NestFastifyApplication;
  const adapter = new FastifyAdapter();

  const uniqueSlug = (): string => `t-${randomUUID().slice(0, 12)}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('مستأجر می‌سازد و همان را برمی‌گرداند', async () => {
    const slug = uniqueSlug();

    const response = await adapter.getInstance().inject({
      method: 'POST',
      url: '/internal/dev/tenants',
      payload: { name: 'طلافروشی نمونه', slug },
    });

    expect(response.statusCode).toBe(201);

    const body = response.json<{ id: string; slug: string; status: string; timezone: string }>();

    expect(body.slug).toBe(slug);
    expect(body.status).toBe('ACTIVE');
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('در نبود timezone، مقدار پیش‌فرض از دیتابیس می‌آید نه از کد', async () => {
    const response = await adapter.getInstance().inject({
      method: 'POST',
      url: '/internal/dev/tenants',
      payload: { name: 'بدون منطقه‌ی زمانی', slug: uniqueSlug() },
    });

    expect(response.json<{ timezone: string }>().timezone).toBe(DEFAULT_TENANT_TIMEZONE);
  });

  it('timezone صریح را نگه می‌دارد', async () => {
    const response = await adapter.getInstance().inject({
      method: 'POST',
      url: '/internal/dev/tenants',
      payload: { name: 'با منطقه‌ی زمانی', slug: uniqueSlug(), timezone: 'UTC' },
    });

    expect(response.json<{ timezone: string }>().timezone).toBe('UTC');
  });

  it('مستأجر ساخته‌شده با شناسه خوانده می‌شود', async () => {
    const slug = uniqueSlug();

    const created = await adapter.getInstance().inject({
      method: 'POST',
      url: '/internal/dev/tenants',
      payload: { name: 'برای خواندن', slug },
    });

    const { id } = created.json<{ id: string }>();

    const fetched = await adapter
      .getInstance()
      .inject({ method: 'GET', url: `/internal/dev/tenants/${id}` });

    expect(fetched.statusCode).toBe(200);
    expect(fetched.json<{ slug: string }>().slug).toBe(slug);
  });

  it('slug تکراری با ۴۰۹ رد می‌شود', async () => {
    const slug = uniqueSlug();
    const payload = { name: 'اولی', slug };

    const first = await adapter
      .getInstance()
      .inject({ method: 'POST', url: '/internal/dev/tenants', payload });

    expect(first.statusCode).toBe(201);

    const duplicate = await adapter.getInstance().inject({
      method: 'POST',
      url: '/internal/dev/tenants',
      payload: { name: 'دومی با همان شناسه', slug },
    });

    expect(duplicate.statusCode).toBe(409);
  });

  it('شناسه‌ی ناموجود ۴۰۴ می‌دهد', async () => {
    const response = await adapter
      .getInstance()
      .inject({ method: 'GET', url: `/internal/dev/tenants/${randomUUID()}` });

    expect(response.statusCode).toBe(404);
  });

  it('شناسه‌ی بدشکل ۴۰۰ می‌دهد، نه ۵۰۰', async () => {
    const response = await adapter
      .getInstance()
      .inject({ method: 'GET', url: '/internal/dev/tenants/not-a-uuid' });

    expect(response.statusCode).toBe(400);
  });

  it.each([
    ['slug با حروف بزرگ', { name: 'x', slug: 'Gold-Shop' }],
    ['نام خالی', { name: '   ', slug: 'valid-slug-a' }],
    ['منطقه‌ی زمانی نامعتبر', { name: 'x', slug: 'valid-slug-b', timezone: 'Asia/Nowhere' }],
    ['بدون slug', { name: 'x' }],
  ])('ورودی نامعتبر رد می‌شود: %s', async (_label, payload) => {
    const response = await adapter
      .getInstance()
      .inject({ method: 'POST', url: '/internal/dev/tenants', payload });

    expect(response.statusCode).toBe(400);
  });
});
