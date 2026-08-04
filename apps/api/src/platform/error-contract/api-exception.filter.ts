import { randomUUID } from 'node:crypto';
import { Catch, HttpException, HttpStatus, Inject, Logger } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module';
import { getPostgresErrorCode } from '../database/pg-errors';
import { RequestContextService } from '../request-context/request-context.service';
import { readRequestId, REQUEST_ID_HEADER } from '../request-context/request-id';
import { ZodValidationException } from '../../shared/validation';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { ApiError, ApiErrorCode } from '@gold/contracts';
import type { AppConfig } from '../config/env.schema';

type ErrorFields = Record<string, string[]>;

interface ErrorMapping {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly fields: ErrorFields;
}

interface HttpReply {
  status(statusCode: number): HttpReply;
  header(name: string, value: string): HttpReply;
  send(payload: ApiError): void;
}

/** پاسخ خام Node که filter برای خطای middleware دریافت می‌کند. */
interface RawHttpResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(payload: string): void;
}

interface HttpRequest {
  readonly method?: string;
  readonly originalUrl?: string;
  readonly url?: string;
  readonly raw?: HttpRequest;
}

const EMPTY_FIELDS: ErrorFields = {};

const DEFAULT_MESSAGES = new Map<number, string>([
  [HttpStatus.BAD_REQUEST, 'درخواست نامعتبر است'],
  [HttpStatus.UNAUTHORIZED, 'احراز هویت لازم است'],
  [HttpStatus.FORBIDDEN, 'اجازه‌ی انجام این عملیات را ندارید'],
  [HttpStatus.NOT_FOUND, 'منبع مورد نظر پیدا نشد'],
  [HttpStatus.CONFLICT, 'این عملیات با وضعیت فعلی داده‌ها سازگار نیست'],
]);

function copyFields(fields: ErrorFields): ErrorFields {
  return Object.fromEntries(Object.entries(fields).map(([field, messages]) => [field, [...messages]]));
}

function readHttpMessage(exception: HttpException, fallback: string): string {
  const response = exception.getResponse();

  if (typeof response === 'string') {
    return response;
  }
  if (
    typeof response === 'object' &&
    response !== null &&
    typeof (response as { message?: unknown }).message === 'string'
  ) {
    return (response as { message: string }).message;
  }

  return fallback;
}

function mapPostgresError(error: unknown): ErrorMapping | undefined {
  switch (getPostgresErrorCode(error)) {
    case '23505':
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'این مقدار از قبل ثبت شده است',
        fields: EMPTY_FIELDS,
      };
    case '23503':
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'ارجاع به داده‌ی مورد نظر معتبر نیست',
        fields: EMPTY_FIELDS,
      };
    case '22001':
    case '22P02':
    case '23514':
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'BAD_REQUEST',
        message: 'مقدار ارسالی معتبر نیست',
        fields: EMPTY_FIELDS,
      };
    default:
      return undefined;
  }
}

function mapHttpException(exception: HttpException): ErrorMapping {
  const status = exception.getStatus();

  if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
    return internalError();
  }

  const code: ApiErrorCode =
    status === HttpStatus.BAD_REQUEST
      ? 'BAD_REQUEST'
      : status === HttpStatus.UNAUTHORIZED
        ? 'UNAUTHORIZED'
        : status === HttpStatus.FORBIDDEN
          ? 'FORBIDDEN'
          : status === HttpStatus.NOT_FOUND
            ? 'NOT_FOUND'
            : status === HttpStatus.CONFLICT
              ? 'CONFLICT'
              : 'HTTP_ERROR';
  const fallback = DEFAULT_MESSAGES.get(status) ?? 'درخواست انجام نشد';

  return { status, code, message: readHttpMessage(exception, fallback), fields: EMPTY_FIELDS };
}

function internalError(): ErrorMapping {
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_ERROR',
    message: 'خطای غیرمنتظره‌ای رخ داد',
    fields: EMPTY_FIELDS,
  };
}

function mapException(exception: unknown): ErrorMapping {
  if (exception instanceof ZodValidationException) {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
      message: 'ورودی نامعتبر است',
      fields: copyFields(exception.fields),
    };
  }

  const postgres = mapPostgresError(exception);
  if (postgres !== undefined) {
    return postgres;
  }
  if (exception instanceof HttpException) {
    return mapHttpException(exception);
  }

  return internalError();
}

function requestPath(request: HttpRequest): string {
  return request.originalUrl ?? request.url ?? request.raw?.originalUrl ?? request.raw?.url ?? '/';
}

function isFastifyReply(reply: HttpReply | RawHttpResponse): reply is HttpReply {
  return typeof (reply as { status?: unknown }).status === 'function';
}

/**
 * خطاهای controller با FastifyReply می‌آیند، اما خطاهای Nest middleware هنوز
 * روی ServerResponse خام هستند. هر دو باید دقیقاً یک payload بگیرند.
 */
function sendError(
  reply: HttpReply | RawHttpResponse,
  status: number,
  requestId: string,
  payload: ApiError,
): void {
  if (isFastifyReply(reply)) {
    reply.status(status).header(REQUEST_ID_HEADER, requestId).send(payload);
    return;
  }

  reply.statusCode = status;
  reply.setHeader(REQUEST_ID_HEADER, requestId);
  reply.setHeader('content-type', 'application/json; charset=utf-8');
  reply.end(JSON.stringify(payload));
}

/**
 * تنها مرز HTTP برای خطاها. هیچ پیام یا stack دیتابیس به response راه ندارد؛
 * حتی در development هم همان قرارداد امن به کلاینت برمی‌گردد.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  readonly #logger = new Logger(ApiExceptionFilter.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RequestContextService) private readonly context: RequestContextService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const reply = http.getResponse<HttpReply | RawHttpResponse>();
    const mapping = mapException(exception);
    const requestId =
      (this.context.hasContext() ? this.context.getRequestId() : undefined) ??
      readRequestId(request) ??
      randomUUID();
    const payload: ApiError = {
      error: {
        code: mapping.code,
        message: mapping.message,
        fields: mapping.fields,
        requestId,
      },
    };

    if (mapping.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const stack = exception instanceof Error && this.config.nodeEnv !== 'production'
        ? exception.stack
        : undefined;
      this.#logger.error(
        JSON.stringify({
          event: 'request_failed',
          requestId,
          statusCode: mapping.status,
          code: mapping.code,
          method: request.method,
          path: requestPath(request),
          exceptionName: exception instanceof Error ? exception.name : 'UnknownException',
          stack,
        }),
      );
    }

    sendError(reply, mapping.status, requestId, payload);
  }
}
