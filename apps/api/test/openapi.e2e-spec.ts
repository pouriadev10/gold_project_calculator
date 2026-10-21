import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * Swagger UI و مستند زنده — BE-070.
 *
 * مستند زنده از کنترلرهای برنامه‌ی در حال اجرا (`ModulesContainer`) ساخته می‌شود و
 * `docs/openapi.json` ِ مخزن از پیمایش ایستای `AppModule`؛ این آزمون برابری این دو را
 * می‌سنجد، یعنی فایل مخزن واقعاً همان چیزی است که سرور سرو می‌کند.
 */
describe('Swagger UI (BE-070)', () => {
  const adapter = new FastifyAdapter();
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('صفحه‌ی Swagger بدون توکن و هدر مستأجر باز می‌شود', async () => {
    const response = await adapter.getInstance().inject({ method: 'GET', url: '/docs' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/u);
    expect(response.body).toContain('SwaggerUIBundle');
    expect(response.body).toContain("url: 'docs/openapi.json'");
  });

  it('مستند زنده دقیقاً همان docs/openapi.json ِ مخزن است', async () => {
    const response = await adapter.getInstance().inject({ method: 'GET', url: '/docs/openapi.json' });
    const committed = JSON.parse(readFileSync(join(__dirname, '../../../docs/openapi.json'), 'utf8')) as unknown;

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(committed);
  });

  it('فایل‌های UI سرو می‌شوند', async () => {
    const css = await adapter.getInstance().inject({ method: 'GET', url: '/docs/assets/swagger-ui.css' });
    const js = await adapter.getInstance().inject({ method: 'GET', url: '/docs/assets/swagger-ui-bundle.js' });

    expect(css.statusCode).toBe(200);
    expect(css.headers['content-type']).toMatch(/^text\/css/u);
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toMatch(/^application\/javascript/u);
  });

  it.each(['package.json', 'index.js', '..%2F..%2Fpackage.json', 'absolute-path.js', 'constructor', 'toString', '__proto__'])(
    'فقط فایل‌های فهرست‌شده — %s ۴۰۴ است',
    async (file) => {
      const response = await adapter.getInstance().inject({ method: 'GET', url: `/docs/assets/${file}` });

      expect(response.statusCode).toBe(404);
    },
  );
});
