import { AsyncLocalStorage } from 'node:async_hooks';

/** سند مالی‌ای که این درخواست برایش سند دفتر کل نوشت. */
export interface LoggedSourceDocument {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly ledgerTransactionId: string;
}

/**
 * آنچه خط پایانی log هر درخواست از آن ساخته می‌شود — BE-067.
 *
 * عمداً mutable است: لایه‌هایی که بعد از middleware اجرا می‌شوند (middleware
 * مستأجر، Guard احراز هویت، filter خطا، posting دفتر کل) هر کدام تکه‌ی خودشان
 * را اضافه می‌کنند و middleware لاگ همان شیء را در لحظه‌ی پایان پاسخ می‌خواند.
 */
export interface RequestLogRecord {
  readonly requestId: string;
  readonly method: string;
  /** مسیر بدون query string — جست‌وجوی نام یا کد ملی هرگز وارد log نمی‌شود. */
  readonly endpoint: string;
  tenantId: string | undefined;
  userId: string | undefined;
  errorCode: string | undefined;
  readonly sourceDocuments: LoggedSourceDocument[];
}

export type RequestLogAnnotation = Partial<Pick<RequestLogRecord, 'tenantId' | 'userId' | 'errorCode'>>;

/** کلیدی که رکورد روی raw request هم می‌نشیند، برای جاهایی که context ندارند. */
const REQUEST_LOG_KEY = 'goldRequestLog';

interface RequestLogCarrier {
  [REQUEST_LOG_KEY]?: RequestLogRecord;
  readonly raw?: RequestLogCarrier;
}

const storage = new AsyncLocalStorage<RequestLogRecord>();

export function createRequestLog(input: {
  readonly requestId: string;
  readonly method: string;
  readonly endpoint: string;
}): RequestLogRecord {
  return {
    requestId: input.requestId,
    method: input.method,
    endpoint: input.endpoint,
    tenantId: undefined,
    userId: undefined,
    errorCode: undefined,
    sourceDocuments: [],
  };
}

/** رکورد را هم در context async و هم روی خود request می‌نشاند و بقیه‌ی زنجیره را اجرا می‌کند. */
export function runWithRequestLog<T>(record: RequestLogRecord, request: object, callback: () => T): T {
  (request as RequestLogCarrier)[REQUEST_LOG_KEY] = record;
  return storage.run(record, callback);
}

/**
 * رکورد درخواست جاری.
 *
 * اول context async، بعد خود request (Fastify یا raw). خارج از درخواست
 * HTTP — مثلاً یک اسکریپت یا تست سرویس — `undefined` است و فراخواننده
 * باید بی‌صدا رد شود: log هرگز نباید یک عملیات مالی را بشکند.
 */
export function findRequestLog(request?: unknown): RequestLogRecord | undefined {
  const current = storage.getStore();

  if (current !== undefined || typeof request !== 'object' || request === null) {
    return current;
  }

  const carrier = request as RequestLogCarrier;

  return carrier[REQUEST_LOG_KEY] ?? carrier.raw?.[REQUEST_LOG_KEY];
}

export function annotateRequestLog(annotation: RequestLogAnnotation, request?: unknown): void {
  const record = findRequestLog(request);

  if (record === undefined) {
    return;
  }
  if (annotation.tenantId !== undefined) {
    record.tenantId = annotation.tenantId;
  }
  if (annotation.userId !== undefined) {
    record.userId = annotation.userId;
  }
  if (annotation.errorCode !== undefined) {
    record.errorCode = annotation.errorCode;
  }
}

/** پیوند درخواست ↔ سند مالی ↔ سند دفتر کل. */
export function recordSourceDocument(document: LoggedSourceDocument): void {
  storage.getStore()?.sourceDocuments.push({ ...document });
}

/** فیلدهایی که pino به **هر** خط log داخل یک درخواست اضافه می‌کند. */
export function requestLogBindings(): Record<string, string> {
  const record = storage.getStore();

  if (record === undefined) {
    return {};
  }

  const bindings: Record<string, string> = { requestId: record.requestId };
  if (record.tenantId !== undefined) {
    bindings.tenantId = record.tenantId;
  }
  if (record.userId !== undefined) {
    bindings.userId = record.userId;
  }

  return bindings;
}
