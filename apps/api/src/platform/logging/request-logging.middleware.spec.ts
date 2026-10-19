import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { Secret } from '../../shared/types/secret';
import { LogCapture } from '../../../test/support/log-capture';
import { createAppLogger } from './app-logger';
import { annotateRequestLog, recordSourceDocument } from './request-log';
import { RequestLoggingMiddleware } from './request-logging.middleware';
import type { ServerResponse } from 'node:http';
import type { MountedRequest } from '../request-context/request-path';

class FakeResponse extends EventEmitter {
  statusCode = 200;

  finish(statusCode: number): void {
    this.statusCode = statusCode;
    this.emit('finish');
    this.emit('close');
  }
}

function setup(requestId = 'request-1', originalUrl = '/sales/invoices/jewelry') {
  const capture = new LogCapture();
  const middleware = new RequestLoggingMiddleware(
    createAppLogger(
      {
        nodeEnv: 'test',
        port: 3000,
        logLevel: 'info',
        databaseUrl: new Secret('postgresql://localhost/gold_test'),
        jwtAccessSecret: new Secret('a'.repeat(32)),
        jwtRefreshSecret: new Secret('b'.repeat(32)),
      },
      capture,
    ),
  );
  const req = {
    method: 'POST',
    originalUrl,
    url: '/',
    headers: { authorization: 'Bearer secret-token' },
    requestId,
  } as unknown as MountedRequest;
  const res = new FakeResponse();

  return { capture, middleware, req, res, serverResponse: res as unknown as ServerResponse };
}

const SALE = {
  sourceType: 'SALES_INVOICE',
  sourceId: '6b7c9d0e-0000-4000-8000-000000000001',
  ledgerTransactionId: '6b7c9d0e-0000-4000-8000-000000000002',
};

describe('RequestLoggingMiddleware', () => {
  it('درخواست موفق: یک خط info با همه‌ی فیلدهای ردیابی و سند منشأ', () => {
    const { capture, middleware, req, res, serverResponse } = setup();

    middleware.use(req, serverResponse, () => {
      annotateRequestLog({ tenantId: 'tenant-1', userId: 'user-1' });
      recordSourceDocument(SALE);
    });
    res.finish(201);

    const lines = capture.records();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info',
      event: 'request_completed',
      requestId: 'request-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      method: 'POST',
      endpoint: '/sales/invoices/jewelry',
      statusCode: 201,
      sourceDocuments: [SALE],
    });
    expect(typeof lines[0]?.durationMs).toBe('number');
    expect(lines[0]).not.toHaveProperty('attemptedSourceDocuments');
    expect(lines[0]).not.toHaveProperty('errorCode');
    expect(capture.text()).not.toContain('secret-token');
  });

  it('درخواست شکست‌خورده: سطح error، کد خطا و سند rollback‌شده با نام جدا', () => {
    const { capture, middleware, req, res, serverResponse } = setup();

    middleware.use(req, serverResponse, () => {
      recordSourceDocument(SALE);
      annotateRequestLog({ errorCode: 'INTERNAL_ERROR' });
    });
    res.finish(500);

    const [line] = capture.records();
    expect(line).toMatchObject({
      level: 'error',
      statusCode: 500,
      errorCode: 'INTERNAL_ERROR',
      attemptedSourceDocuments: [SALE],
    });
    expect(line).not.toHaveProperty('sourceDocuments');
  });

  it('خطای کاربر سطح warn است و query string (مثلاً جست‌وجوی کد ملی) log نمی‌شود', () => {
    const { capture, middleware, req, res, serverResponse } = setup('request-2', '/parties?q=0012345678');

    middleware.use(req, serverResponse, () => {
      annotateRequestLog({ errorCode: 'VALIDATION_ERROR' });
    });
    res.finish(400);

    expect(capture.records()[0]).toMatchObject({
      level: 'warn',
      endpoint: '/parties',
      errorCode: 'VALIDATION_ERROR',
    });
    expect(capture.text()).not.toContain('0012345678');
  });

  it('اتصال قطع‌شده پیش از پایان پاسخ: aborted و بدون sourceDocuments', () => {
    const { capture, middleware, req, res, serverResponse } = setup();

    middleware.use(req, serverResponse, () => {
      recordSourceDocument(SALE);
    });
    res.emit('close');

    expect(capture.records()).toEqual([
      expect.objectContaining({ aborted: true, attemptedSourceDocuments: [SALE] }),
    ]);
  });

  it('بدون request ID اجرا نمی‌شود — ترتیب middlewareها اشتباه است', () => {
    const { middleware, req, serverResponse } = setup('');

    expect(() => middleware.use(req, serverResponse, () => undefined)).toThrow(/request id/);
  });
});
