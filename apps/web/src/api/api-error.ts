/**
 * خطاهای مرز شبکه — جدا از `client.ts` نگه داشته شده تا هر کدی که فقط
 * می‌خواهد `instanceof ApiError` بسنجد (مثلاً یک مرز خطای سراسری در آینده،
 * FE-009) مجبور نباشد کل ماشین fetch/timeout/retry را هم import کند.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** خطای هر فیلد فرم — کلید نام فیلد، مقدار فهرست پیام‌ها. برای خطای غیر-اعتبارسنجی خالی است. */
  readonly fields: Record<string, string[]>;
  /** همان شناسه‌ای که در log سرور ثبت شده. خطاهای ساخته‌شده سمت کلاینت (شبکه، SCHEMA_MISMATCH) شناسه ندارند. */
  readonly requestId: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Record<string, string[]> = {},
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.requestId = requestId;
  }
}

/** خطای شبکه یا پاسخ نامعتبر — پیام فارسی برای نمایش مستقیم به کاربر. */
export class NetworkError extends Error {
  constructor(message = 'ارتباط با سرور برقرار نشد') {
    super(message);
    this.name = 'NetworkError';
  }
}
