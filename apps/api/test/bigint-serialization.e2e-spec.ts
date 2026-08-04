import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { presentBigIntResponse } from '../src/shared/serialization';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { RialString, WeightMgString } from '@gold/contracts';

interface BalanceResponse {
  readonly amountRial: RialString;
  readonly position: { readonly weightMg: WeightMgString };
}

/** DTO قرارداد خروجی‌اش صریحاً string است، نه bigint. */
@Controller('serialization-probe')
class SerializationProbeController {
  @Get()
  getBalance(): BalanceResponse {
    return presentBigIntResponse({
      amountRial: 12500000n,
      position: { weightMg: 1250n },
    });
  }
}

@Module({ controllers: [SerializationProbeController] })
class SerializationProbeModule {}

describe('سریال‌سازی bigint در پاسخ HTTP', () => {
  const adapter = new FastifyAdapter();
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SerializationProbeModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('12500000n را بدون خطای JSON به "12500000" تبدیل می‌کند', async () => {
    const response = await adapter.getInstance().inject({
      method: 'GET',
      url: '/serialization-probe',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<BalanceResponse>()).toEqual({
      amountRial: '12500000',
      position: { weightMg: '1250' },
    });
  });
});
