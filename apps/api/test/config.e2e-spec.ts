import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { APP_CONFIG } from '../src/platform/config/config.module';
import type { AppConfig } from '../src/platform/config/env.schema';
import type { INestApplicationContext } from '@nestjs/common';

/**
 * تنظیمات باید از طریق DI در دسترس باشد — BE-006 و BE-011 از همین توکن
 * `databaseUrl` و کلیدهای امضا را می‌گیرند.
 */
describe('ConfigModule', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('تنظیمات معتبرشده از هر جای برنامه قابل تزریق است', () => {
    const config = app.get<AppConfig>(APP_CONFIG);

    expect(config.nodeEnv).toBe('test');
    expect(typeof config.port).toBe('number');
    expect(config.databaseUrl.reveal()).toContain('postgresql://');
  });

  it('مقادیر حساس حتی از داخل container هم چاپ‌شدنی نیستند', () => {
    const config = app.get<AppConfig>(APP_CONFIG);

    expect(JSON.stringify(config)).not.toContain(config.jwtAccessSecret.reveal());
    expect(String(config.databaseUrl)).toBe('[REDACTED]');
  });
});
