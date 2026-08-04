import 'reflect-metadata';
import { Body, ConflictException, Controller, Get, Module, NotFoundException, Post } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { apiErrorSchema } from '@gold/contracts';
import { AppModule } from '../src/app.module';
import { ZodValidationPipe } from '../src/shared/validation';
import { REQUEST_ID_HEADER } from '../src/platform/request-context/request-id';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

const validationSchema = z.object({ name: z.string().min(1, 'نام الزامی است') });

@Controller('auth/error-probe')
class ErrorProbeController {
  @Post('validation')
  validation(@Body(new ZodValidationPipe(validationSchema)) _body: { name: string }): void {}

  @Get('not-found')
  notFound(): void {
    throw new NotFoundException('رکورد آزمایشی پیدا نشد');
  }

  @Get('conflict')
  conflict(): void {
    throw new ConflictException('داده‌ی آزمایشی تکراری است');
  }

  @Get('postgres')
  postgres(): void {
    const error = new Error('duplicate key value violates unique constraint "private_schema_secret"') as Error & {
      code: string;
      detail: string;
    };
    error.code = '23505';
    error.detail = 'Key (email)=(private@example.com) already exists.';
    throw error;
  }

  @Get('internal')
  internal(): void {
    throw new Error('passwordHash and table private_schema_secret must never reach the client');
  }
}

@Module({ controllers: [ErrorProbeController] })
class ErrorProbeModule {}

describe('قرارداد استاندارد خطا', () => {
  const adapter = new FastifyAdapter();
  const loggerError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ErrorProbeModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);
    await app.init();
    await adapter.getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    loggerError.mockRestore();
  });

  it('خطای validation همان قرارداد و fields را دارد', async () => {
    const response = await adapter.getInstance().inject({
      method: 'POST',
      url: '/auth/error-probe/validation',
      payload: { name: '' },
    });
    const body = apiErrorSchema.parse(response.json());

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.fields).toEqual({ name: ['نام الزامی است'] });
  });

  it('Not Found و Conflict یک قرارداد واحد دارند', async () => {
    const [notFound, conflict] = await Promise.all([
      adapter.getInstance().inject({ method: 'GET', url: '/auth/error-probe/not-found' }),
      adapter.getInstance().inject({ method: 'GET', url: '/auth/error-probe/conflict' }),
    ]);

    const notFoundBody = apiErrorSchema.parse(notFound.json());
    const conflictBody = apiErrorSchema.parse(conflict.json());

    expect(notFound.statusCode).toBe(404);
    expect(notFoundBody.error.code).toBe('NOT_FOUND');
    expect(conflict.statusCode).toBe(409);
    expect(conflictBody.error.code).toBe('CONFLICT');
    expect(notFoundBody.error.fields).toEqual({});
    expect(conflictBody.error.fields).toEqual({});
  });

  it('۴۰۴ مسیریابی‌شده هم قرارداد واحد دارد', async () => {
    const response = await adapter.getInstance().inject({
      method: 'GET',
      url: '/auth/error-probe/does-not-exist',
    });
    const body = apiErrorSchema.parse(response.json());

    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('خطای middleware مستأجر هم قرارداد و request ID دارد', async () => {
    const response = await adapter.getInstance().inject({
      method: 'GET',
      url: '/internal/dev/context',
    });
    const body = apiErrorSchema.parse(response.json());

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(response.headers[REQUEST_ID_HEADER]).toBe(body.error.requestId);
  });

  it('خطای PostgreSQL schema و detail داخلی را افشا نمی‌کند', async () => {
    const response = await adapter.getInstance().inject({
      method: 'GET',
      url: '/auth/error-probe/postgres',
    });
    const body = apiErrorSchema.parse(response.json());

    expect(response.statusCode).toBe(409);
    expect(body.error).toMatchObject({ code: 'CONFLICT', fields: {} });
    expect(response.body).not.toContain('private_schema_secret');
    expect(response.body).not.toContain('private@example.com');
  });

  it('خطای داخلی stack و داده‌ی حساس را پنهان می‌کند و request ID را log می‌کند', async () => {
    const response = await adapter.getInstance().inject({
      method: 'GET',
      url: '/auth/error-probe/internal',
    });
    const body = apiErrorSchema.parse(response.json());

    expect(response.statusCode).toBe(500);
    expect(body.error).toMatchObject({ code: 'INTERNAL_ERROR', fields: {} });
    expect(response.body).not.toContain('passwordHash');
    expect(response.body).not.toContain('private_schema_secret');
    expect(response.body).not.toContain('stack');
    expect(response.headers[REQUEST_ID_HEADER]).toBe(body.error.requestId);
    expect(
      loggerError.mock.calls.some(([message]) => String(message).includes(body.error.requestId)),
    ).toBe(true);
  });
});
