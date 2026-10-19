import { performance } from 'node:perf_hooks';
import { Inject, Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { readRequestId } from '../request-context/request-id';
import { resolveRequestPath } from '../request-context/request-path';
import type { MountedRequest } from '../request-context/request-path';
import { APP_LOGGER } from './logging.tokens';
import { createRequestLog, runWithRequestLog } from './request-log';
import type { AppLogger } from './app-logger';
import type { RequestLogRecord } from './request-log';

const HTTP_SERVER_ERROR = 500;
const HTTP_CLIENT_ERROR = 400;

function completionFields(
  record: RequestLogRecord,
  statusCode: number,
  durationMs: number,
  aborted: boolean,
): Record<string, unknown> {
  const succeeded = statusCode < HTTP_CLIENT_ERROR && !aborted;

  return {
    event: 'request_completed',
    requestId: record.requestId,
    tenantId: record.tenantId,
    userId: record.userId,
    method: record.method,
    endpoint: record.endpoint,
    statusCode,
    durationMs,
    errorCode: record.errorCode,
    aborted: aborted ? true : undefined,
    /*
     * نوشتن دفتر کل داخل تراکنش PostgreSQL است؛ اگر درخواست شکست خورده باشد
     * آن ردیف‌ها rollback شده‌اند. نام فیلد همین را می‌گوید تا کسی شناسه‌ی
     * سندی را که وجود ندارد در دیتابیس دنبال نکند.
     */
    sourceDocuments:
      succeeded && record.sourceDocuments.length > 0 ? record.sourceDocuments : undefined,
    attemptedSourceDocuments:
      !succeeded && record.sourceDocuments.length > 0 ? record.sourceDocuments : undefined,
  };
}

/**
 * یک خط log در پایان هر درخواست — BE-067.
 *
 * بلافاصله بعد از `RequestIdMiddleware` اجرا می‌شود تا حتی درخواستی که در
 * middleware مستأجر رد می‌شود هم خط پایانی‌اش را داشته باشد. پایان را از
 * رویداد `finish`/`close` همان پاسخ خام می‌گیرد، پس پاسخ موفق Fastify و
 * پاسخ خطایی که filter مستقیم روی ServerResponse می‌نویسد هر دو را می‌بیند.
 *
 * هیچ هدر، بدنه یا query stringی log نمی‌شود — این ساده‌ترین تضمین است که
 * رمز، توکن و کد ملی به log نرسند؛ پاک‌سازی logger لایه‌ی دوم است.
 */
@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(@Inject(APP_LOGGER) private readonly logger: AppLogger) {}

  use(req: MountedRequest, res: ServerResponse, next: (error?: unknown) => void): void {
    const requestId = readRequestId(req);

    if (requestId === undefined) {
      throw new Error('request id middleware باید پیش از request logging اجرا شود');
    }

    const startedAt = performance.now();
    const record = createRequestLog({
      requestId,
      method: req.method ?? 'UNKNOWN',
      endpoint: resolveRequestPath(req),
    });
    let completed = false;

    /*
     * `finish` یعنی پاسخ کامل تحویل شد؛ `close` بدون `finish` قبلی یعنی اتصال
     * پیش از پایان بسته شد. به `writableFinished` تکیه نشده چون `inject` در
     * Fastify (light-my-request) `finish` را بدون ست کردنش منتشر می‌کند.
     */
    const complete = (aborted: boolean): void => {
      if (completed) {
        return;
      }
      completed = true;

      const fields = completionFields(
        record,
        res.statusCode,
        performance.now() - startedAt,
        aborted,
      );

      if (res.statusCode >= HTTP_SERVER_ERROR) {
        this.logger.error(fields, 'request completed');
      } else if (res.statusCode >= HTTP_CLIENT_ERROR) {
        this.logger.warn(fields, 'request completed');
      } else {
        this.logger.info(fields, 'request completed');
      }
    };

    res.once('finish', () => complete(false));
    res.once('close', () => complete(true));

    runWithRequestLog(record, req, () => {
      next();
    });
  }
}
