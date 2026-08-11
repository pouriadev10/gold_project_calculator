import { ApiError, NetworkError } from './api-error';

/**
 * متن‌های خطای API برای نمایش در رابط کاربر.
 *
 * خودِ قرارداد API پیام فارسی امن دارد، اما این نگاشت عمداً پیام‌های اصلی را از
 * کد و وضعیت HTTP می‌سازد. در نتیجه اگر یک سرویس در آینده پیام نامناسبی برگرداند،
 * جزئیات PostgreSQL یا stack trace راهی به رابط کاربر پیدا نمی‌کند.
 */
export type ApiErrorKind =
  | 'validation'
  | 'conflict'
  | 'session-expired'
  | 'forbidden'
  | 'network'
  | 'not-found'
  | 'server'
  | 'unknown';

export interface ApiErrorPresentation {
  readonly kind: ApiErrorKind;
  readonly title: string;
  readonly message: string;
  readonly fields: Readonly<Record<string, readonly string[]>>;
  readonly requestId: string | undefined;
}

const EMPTY_FIELDS: Readonly<Record<string, readonly string[]>> = {};

const UNSAFE_MESSAGE_PATTERN =
  /\b(?:postgres(?:ql)?|stack\s*trace|select\s+.+\s+from|syntax\s+error)\b/i;

function safeFieldMessages(messages: readonly string[]): readonly string[] {
  return messages.filter((message) => !UNSAFE_MESSAGE_PATTERN.test(message));
}

function safeFields(
  fields: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, readonly string[]>> {
  const safeEntries = Object.entries(fields)
    .map(([name, messages]) => [name, safeFieldMessages(messages)] as const)
    .filter(([, messages]) => messages.length > 0);

  return Object.fromEntries(safeEntries);
}

function presentation(
  kind: ApiErrorKind,
  title: string,
  message: string,
  fields: Readonly<Record<string, readonly string[]>> = EMPTY_FIELDS,
  requestId?: string,
): ApiErrorPresentation {
  return { kind, title, message, fields: safeFields(fields), requestId };
}

/**
 * هر خطای مرز API را به مدل نمایشیِ امن و فارسی تبدیل می‌کند.
 *
 * این تابع عمداً هیچ toast تولید نمی‌کند. فراخواننده باید `ApiErrorNotice` را در
 * صفحه نگه دارد تا خطای ثبت عملیات مالی تا اقدام بعدی کاربر ناپدید نشود.
 */
export function presentApiError(error: unknown): ApiErrorPresentation {
  if (error instanceof NetworkError) {
    return presentation(
      'network',
      'ارتباط با سرور برقرار نشد',
      'اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.',
    );
  }

  if (!(error instanceof ApiError)) {
    return presentation(
      'unknown',
      'انجام عملیات ممکن نشد',
      'مشکلی غیرمنتظره رخ داد. لطفاً دوباره تلاش کنید.',
    );
  }

  if (error.status === 401 || error.code === 'UNAUTHORIZED') {
    return presentation(
      'session-expired',
      'نشست شما منقضی شده است',
      'برای ادامه، دوباره وارد حساب کاربری شوید.',
      EMPTY_FIELDS,
      error.requestId,
    );
  }

  if (error.status === 403 || error.code === 'FORBIDDEN') {
    return presentation(
      'forbidden',
      'اجازه انجام این عملیات را ندارید',
      'اگر فکر می‌کنید این دسترسی باید برای شما فعال باشد، با مدیر سامانه تماس بگیرید.',
      EMPTY_FIELDS,
      error.requestId,
    );
  }

  if (
    error.status === 409 ||
    error.code === 'CONFLICT' ||
    error.code === 'IDEMPOTENCY_KEY_CONFLICT'
  ) {
    return presentation(
      'conflict',
      'تغییر هم‌زمان در داده‌ها',
      'اطلاعات تغییر کرده است. صفحه را تازه‌سازی کنید و دوباره بررسی کنید.',
      EMPTY_FIELDS,
      error.requestId,
    );
  }

  if (error.status === 404 || error.code === 'NOT_FOUND') {
    return presentation(
      'not-found',
      'اطلاعات مورد نظر پیدا نشد',
      'ممکن است این اطلاعات حذف شده یا دیگر در دسترس نباشد.',
      EMPTY_FIELDS,
      error.requestId,
    );
  }

  if (error.status === 400 || error.code === 'VALIDATION_ERROR' || error.code === 'BAD_REQUEST') {
    return presentation(
      'validation',
      'اطلاعات واردشده را بررسی کنید',
      'موارد مشخص‌شده را اصلاح و دوباره ثبت کنید.',
      error.fields,
      error.requestId,
    );
  }

  if (error.status >= 500 || error.code === 'INTERNAL_ERROR') {
    return presentation(
      'server',
      'خطا در انجام عملیات',
      'سامانه نتوانست عملیات را کامل کند. چند لحظه دیگر دوباره تلاش کنید.',
      EMPTY_FIELDS,
      error.requestId,
    );
  }

  return presentation(
    'unknown',
    'انجام عملیات ممکن نشد',
    'مشکلی رخ داد. لطفاً دوباره تلاش کنید.',
    EMPTY_FIELDS,
    error.requestId,
  );
}
