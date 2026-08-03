import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * معیار پذیرش BE-007: «endpointهای dev در production قابل دسترسی نباشند».
 *
 * `NODE_ENV` **پیش از** import کردن `AppModule` تنظیم می‌شود و import هم
 * پویاست — چون فهرست controllerهای `TenantModule` در لحظه‌ی ارزیابی
 * دکوراتور قطعی می‌شود، یعنی همان لحظه‌ای که ماژول import می‌شود. با
 * import ایستا در بالای فایل، ماژول پیش از این خط بارگذاری شده بود و
 * تست چیزی جز خودش را اثبات نمی‌کرد.
 *
 * vitest هر فایل تست را در محیط جدا اجرا می‌کند، پس این تغییر به بقیه‌ی
 * فایل‌ها نشت نمی‌کند.
 */
process.env.NODE_ENV = 'production';

describe('endpointهای توسعه در production (نیازمند PostgreSQL واقعی)', () => {
  let app: NestFastifyApplication;
  const adapter = new FastifyAdapter();

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('محیط واقعاً production است — وگرنه این فایل چیزی اثبات نمی‌کند', () => {
    expect(process.env.NODE_ENV).toBe('production');
  });

  it('ساخت مستأجر از مسیر توسعه ۴۰۴ می‌دهد', async () => {
    const response = await adapter.getInstance().inject({
      method: 'POST',
      url: '/internal/dev/tenants',
      payload: { name: 'نباید ساخته شود', slug: 'must-not-exist' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('خواندن مستأجر از مسیر توسعه ۴۰۴ می‌دهد', async () => {
    const response = await adapter
      .getInstance()
      .inject({ method: 'GET', url: `/internal/dev/tenants/${randomUUID()}` });

    expect(response.statusCode).toBe(404);
  });

  it('مسیر اصلاً در جدول مسیریابی ثبت نشده، نه اینکه نگهبان جلویش را بگیرد', () => {
    const routes = adapter.getInstance().printRoutes({ commonPrefix: false });

    expect(routes).not.toMatch(/internal/i);
    expect(routes).toContain('health');
  });
});
