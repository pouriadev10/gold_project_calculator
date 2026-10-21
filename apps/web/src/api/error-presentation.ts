import { InvalidPdfError } from '@/lib/pdf-file';
import { ApiError, NetworkError, OfflineError } from './api-error';

/**
 * متن‌های خطای API برای نمایش در رابط کاربر.
 *
 * خودِ قرارداد API پیام فارسی امن دارد، اما این نگاشت عمداً پیام‌های اصلی را از
 * کد و وضعیت HTTP می‌سازد. در نتیجه اگر یک سرویس در آینده پیام نامناسبی برگرداند،
 * جزئیات PostgreSQL یا stack trace راهی به رابط کاربر پیدا نمی‌کند.
 */
export type ApiErrorKind =
  | 'validation'
  | 'business-rule'
  | 'conflict'
  | 'retry-after-refresh'
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

/** کد خطای قاعده‌ی کسب‌وکار سرور (M-09) — همان `BUSINESS_RULE_ERROR_CODE` ِ API. */
const BUSINESS_RULE_CODE = 'BUSINESS_RULE_VIOLATION';
/** سقف طول پیام سرور که نمایش داده می‌شود؛ مرز نمایشی، نه عدد صنفی. */
const MAX_SERVER_MESSAGE_LENGTH = 200;
const BUSINESS_RULE_FALLBACK = 'این عملیات با قواعد ثبت سازگار نیست. اطلاعات را بررسی کنید.';

/**
 * پیام فارسی ِ قاعده‌ی کسب‌وکار از سرور — تنها جایی که پیام سرور مستقیم نمایش داده می‌شود،
 * چون خود پیام همان علت است («موجودی کافی نیست»). همان صافی ِ پیام ناامن روی آن اعمال
 * می‌شود؛ اگر رد شد یا خالی/بلند بود، متن عمومی جایش می‌نشیند.
 */
function businessRuleMessage(message: string): string {
  const trimmed = message.trim();
  return trimmed === '' || trimmed.length > MAX_SERVER_MESSAGE_LENGTH || UNSAFE_MESSAGE_PATTERN.test(trimmed)
    ? BUSINESS_RULE_FALLBACK
    : trimmed;
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
  // FE-090: پیش از NetworkError — زیرکلاس آن است ولی پیامش باید صریح بگوید چیزی نگه داشته نشد
  if (error instanceof OfflineError) {
    return presentation(
      'network',
      'اتصال اینترنت قطع است',
      'در حالت آفلاین هیچ معامله یا عملیات مالی ثبت نمی‌شود و چیزی برای ارسال بعدی نگه داشته نمی‌شود. پس از وصل شدن، دوباره ثبت کنید.',
    );
  }

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

  /*
   * سنتزشده در client.ts (FE-027)، نه از سرور — کد را قبل از هر بررسی
   * status چک کن تا با ۴۰۹ واقعی (conflict) قاطی نشود. نشست معتبر است؛
   * فقط همان نوشتن مالی خودکار دوباره ارسال نشده، پس پیام «نشست منقضی
   * شده» اینجا گمراه‌کننده است — کاربر هنوز وارد است.
   */
  if (error.code === 'RETRY_AFTER_REFRESH') {
    return presentation(
      'retry-after-refresh',
      'لازم است دوباره ثبت کنید',
      'نشست شما تازه شد. برای اطمینان، دوباره دکمه‌ی ثبت را بزنید.',
      EMPTY_FIELDS,
      error.requestId,
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

  // M-09: پیش از ۴۰۹/۴۰۰ — «موجودی کافی نیست» نه تغییر هم‌زمان داده است نه خطای فرم.
  if (error.code === BUSINESS_RULE_CODE) {
    return presentation(
      'business-rule',
      'این عملیات انجام نشد',
      businessRuleMessage(error.message),
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

/**
 * خطای دریافت PDF یک سند (FE-077/FE-078). سرور برای سندِ مستأجر دیگر،
 * پیش‌نویس یا ناموجود همان ۴۰۴ را برمی‌گرداند؛ پیام همین سه حالت را بی‌آنکه
 * وجود سند را در مستأجر دیگر لو دهد می‌گوید.
 */
export function presentPdfError(error: unknown): ApiErrorPresentation {
  if (error instanceof InvalidPdfError) {
    return presentation('server', 'فایل PDF معتبر دریافت نشد', 'پاسخ سرور فایل PDF نبود؛ دوباره تلاش کنید.');
  }
  const base = presentApiError(error);
  if (base.kind === 'not-found') {
    return {
      ...base,
      title: 'PDF این سند در دسترس نیست',
      message: 'سند پیدا نشد، هنوز نهایی نشده یا به این فروشگاه تعلق ندارد.',
    };
  }
  if (base.kind === 'forbidden') {
    return { ...base, title: 'اجازه دریافت این PDF را ندارید' };
  }
  return base;
}
