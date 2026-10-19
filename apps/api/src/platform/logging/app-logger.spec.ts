import { describe, expect, it } from 'vitest';
import { Secret } from '../../shared/types/secret';
import { LogCapture } from '../../../test/support/log-capture';
import { createAppLogger, shouldLogStackTraces } from './app-logger';
import { NestPinoLogger } from './nest-logger';
import {
  annotateRequestLog,
  createRequestLog,
  findRequestLog,
  recordSourceDocument,
  requestLogBindings,
  runWithRequestLog,
} from './request-log';
import type { AppConfig, LogLevel, NodeEnv } from '../config/env.schema';

function configFor(logLevel: LogLevel = 'info', nodeEnv: NodeEnv = 'test'): AppConfig {
  return {
    nodeEnv,
    port: 3000,
    logLevel,
    databaseUrl: new Secret('postgresql://gold:gold@localhost:5432/gold_test'),
    jwtAccessSecret: new Secret('a'.repeat(32)),
    jwtRefreshSecret: new Secret('b'.repeat(32)),
  };
}

function record(requestId = 'request-1') {
  return createRequestLog({ requestId, method: 'POST', endpoint: '/sales/invoices/jewelry' });
}

describe('createAppLogger', () => {
  it('هر خط یک JSON با سطح متنی، زمان ISO و نام سرویس است', () => {
    const capture = new LogCapture();

    createAppLogger(configFor(), capture).info({ event: 'probe' }, 'hello');

    const [line] = capture.records();
    expect(line).toMatchObject({ level: 'info', service: 'gold-api', event: 'probe', msg: 'hello' });
    expect(typeof line?.time).toBe('string');
    expect(Number.isNaN(new Date(String(line?.time)).getTime())).toBe(false);
  });

  it('سطح LOG_LEVEL را رعایت می‌کند', () => {
    const capture = new LogCapture();
    const logger = createAppLogger(configFor('warn'), capture);

    logger.info('hidden');
    logger.warn('shown');

    expect(capture.records().map((line) => line.msg)).toEqual(['shown']);
  });

  it('رمز، توکن و کد ملی کامل هرگز به خروجی نمی‌رسند', () => {
    const capture = new LogCapture();

    createAppLogger(configFor(), capture).info({
      body: { email: 'a@example.com', password: 'Secret-Pass-1', nationalId: '0012345678' },
      headers: { authorization: 'Bearer eyJhbGciOi.payload.sig' },
      refreshToken: 'refresh-raw-value',
    });

    const text = capture.text();
    expect(text).not.toContain('Secret-Pass-1');
    expect(text).not.toContain('0012345678');
    expect(text).not.toContain('eyJhbGciOi');
    expect(text).not.toContain('refresh-raw-value');
    expect(capture.records()[0]).toMatchObject({
      body: { email: 'a@example.com', password: '[REDACTED]', nationalId: '******5678' },
      headers: { authorization: '[REDACTED]' },
      refreshToken: '[REDACTED]',
    });
  });

  it('داخل درخواست، requestId/tenantId/userId خودکار به هر خط اضافه می‌شود', () => {
    const capture = new LogCapture();
    const logger = createAppLogger(configFor(), capture);
    const current = record('request-42');

    runWithRequestLog(current, {}, () => {
      annotateRequestLog({ tenantId: 'tenant-1', userId: 'user-1' });
      logger.info({ event: 'inside' });
    });
    logger.info({ event: 'outside' });

    const [inside, outside] = capture.records();
    expect(inside).toMatchObject({ requestId: 'request-42', tenantId: 'tenant-1', userId: 'user-1' });
    expect(outside).not.toHaveProperty('requestId');
  });

  it('stack فقط بیرون از production', () => {
    expect(shouldLogStackTraces(configFor('info', 'development'))).toBe(true);
    expect(shouldLogStackTraces(configFor('info', 'test'))).toBe(true);
    expect(shouldLogStackTraces(configFor('info', 'production'))).toBe(false);
  });
});

describe('request log context', () => {
  it('بیرون از درخواست همه‌ی عملیات بی‌اثرند و خطا نمی‌دهند', () => {
    expect(findRequestLog()).toBeUndefined();
    expect(findRequestLog(null)).toBeUndefined();
    expect(requestLogBindings()).toEqual({});
    expect(() => {
      annotateRequestLog({ tenantId: 't' });
      recordSourceDocument({ sourceType: 'SALES_INVOICE', sourceId: 's', ledgerTransactionId: 'l' });
    }).not.toThrow();
  });

  it('از روی خود request (Fastify یا raw) هم پیدا می‌شود', () => {
    const current = record();
    const raw = {};
    runWithRequestLog(current, raw, () => undefined);

    expect(findRequestLog(raw)).toBe(current);
    expect(findRequestLog({ raw })).toBe(current);

    annotateRequestLog({ errorCode: 'NOT_FOUND' }, { raw });
    expect(current.errorCode).toBe('NOT_FOUND');
  });

  it('annotation فیلد undefined را بازنویسی نمی‌کند و سند منشأ کپی می‌شود', () => {
    const current = record();
    const document = { sourceType: 'SALES_INVOICE', sourceId: 'inv-1', ledgerTransactionId: 'lt-1' };

    runWithRequestLog(current, {}, () => {
      annotateRequestLog({ tenantId: 'tenant-1', userId: 'user-1' });
      annotateRequestLog({});
      recordSourceDocument(document);
    });

    expect(current).toMatchObject({ tenantId: 'tenant-1', userId: 'user-1', errorCode: undefined });
    expect(current.sourceDocuments).toEqual([document]);
    expect(current.sourceDocuments[0]).not.toBe(document);
  });
});

describe('NestPinoLogger', () => {
  function setup(nodeEnv: NodeEnv = 'test') {
    const capture = new LogCapture();
    const config = configFor('trace', nodeEnv);
    return { capture, logger: new NestPinoLogger(createAppLogger(config, capture), config) };
  }

  it('هر سطح Nest به سطح pino با context نگاشت می‌شود', () => {
    const { capture, logger } = setup();

    logger.log('started', 'NestApplication');
    logger.warn('careful', 'Ctx');
    logger.debug('details');
    logger.verbose('noise', 'Ctx');
    logger.fatal({ reason: 'x' }, 'Ctx');

    expect(capture.records().map(({ level, msg, context }) => ({ level, msg, context }))).toEqual([
      { level: 'info', msg: 'started', context: 'NestApplication' },
      { level: 'warn', msg: 'careful', context: 'Ctx' },
      { level: 'debug', msg: 'details', context: undefined },
      { level: 'trace', msg: 'noise', context: 'Ctx' },
      { level: 'fatal', msg: '{"reason":"x"}', context: 'Ctx' },
    ]);
  });

  it('error(message, stack, context): stack فقط بیرون از production', () => {
    const dev = setup('development');
    const prod = setup('production');

    dev.logger.error('boom', 'Error: boom\n    at x', 'ExceptionHandler');
    prod.logger.error('boom', 'Error: boom\n    at x', 'ExceptionHandler');
    dev.logger.error('only message');

    expect(dev.capture.records()[0]).toMatchObject({
      level: 'error',
      msg: 'boom',
      context: 'ExceptionHandler',
      stack: 'Error: boom\n    at x',
    });
    expect(prod.capture.records()[0]).not.toHaveProperty('stack');
    expect(dev.capture.records()[1]).toMatchObject({ msg: 'only message' });
    expect(dev.capture.records()[1]).not.toHaveProperty('context');
  });
});
