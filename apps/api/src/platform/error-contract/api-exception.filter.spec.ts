import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { Secret } from '../../shared/types/secret';
import { LogCapture } from '../../../test/support/log-capture';
import { createAppLogger } from '../logging/app-logger';
import { createRequestLog, runWithRequestLog } from '../logging/request-log';
import { RequestContextService } from '../request-context/request-context.service';
import { ApiExceptionFilter } from './api-exception.filter';
import type { ArgumentsHost } from '@nestjs/common';
import type { AppConfig, NodeEnv } from '../config/env.schema';

function setup(nodeEnv: NodeEnv) {
  const capture = new LogCapture();
  const config: AppConfig = {
    nodeEnv,
    port: 3000,
    logLevel: 'info',
    databaseUrl: new Secret('postgresql://localhost/gold_test'),
    jwtAccessSecret: new Secret('a'.repeat(32)),
    jwtRefreshSecret: new Secret('b'.repeat(32)),
  };
  const filter = new ApiExceptionFilter(config, new RequestContextService(), createAppLogger(config, capture));
  const sent: { status?: number } = {};
  const reply = {
    status(code: number) {
      sent.status = code;
      return reply;
    },
    header() {
      return reply;
    },
    send() {
      return undefined;
    },
  };
  const raw = { requestId: 'request-9', method: 'GET', originalUrl: '/parties?q=0012345678' };
  const request = { method: 'GET', url: '/parties?q=0012345678', raw };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
  } as unknown as ArgumentsHost;

  return { capture, filter, host, raw, sent };
}

function failure(): Error {
  return new Error('Failed query: select ... params: 0012345678,Secret-Pass-1');
}

describe('ApiExceptionFilter — log', () => {
  it('خطای داخلی در development با stack log می‌شود', () => {
    const { capture, filter, host } = setup('development');

    filter.catch(failure(), host);

    expect(capture.records()[0]).toMatchObject({
      level: 'error',
      event: 'request_failed',
      requestId: 'request-9',
      code: 'INTERNAL_ERROR',
      path: '/parties',
      exceptionName: 'Error',
    });
    expect(String(capture.records()[0]?.stack)).toContain('Failed query');
  });

  it('در production نه stack و نه پیام خطا (که پارامتر کوئری دارد) log می‌شود', () => {
    const { capture, filter, host } = setup('production');

    filter.catch(failure(), host);

    expect(capture.records()[0]).toMatchObject({ event: 'request_failed', requestId: 'request-9' });
    expect(capture.records()[0]).not.toHaveProperty('stack');
    expect(capture.text()).not.toContain('0012345678');
    expect(capture.text()).not.toContain('Secret-Pass-1');
  });

  it('کد خطا به رکورد log درخواست می‌رسد؛ خطای ۴xx خط request_failed ندارد', () => {
    const { capture, filter, host, raw, sent } = setup('production');
    const record = createRequestLog({ requestId: 'request-9', method: 'GET', endpoint: '/parties' });

    runWithRequestLog(record, raw, () => undefined);
    filter.catch(new NotFoundException(), host);

    expect(sent.status).toBe(404);
    expect(record.errorCode).toBe('NOT_FOUND');
    expect(capture.lines).toEqual([]);
  });
});
