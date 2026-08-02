import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';

/**
 * برخلاف تست واحد، اینجا یک سرور واقعی Fastify روی یک پورت آزاد (`0`)
 * بالا می‌آید و درخواست از روی سوکت می‌رود — تا مسیر مسیریابی و
 * سریال‌سازی هم واقعاً بررسی شود، نه فقط بدنه‌ی متد کنترلر.
 */
describe('GET /health (e2e)', () => {
  let app: NestFastifyApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('پاسخ ۲۰۰ با بدنه‌ی دقیقاً { "status": "ok" } می‌دهد', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"status":"ok"}');
  });
});
