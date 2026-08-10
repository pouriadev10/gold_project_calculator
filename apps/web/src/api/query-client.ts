import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError, NetworkError } from './api-error';

/** بیشینه‌ی تلاش مجدد یک query — یک بار، نه بی‌پایان. شبکه‌ی پاساژ ضعیف است، ولی باتری هم تمام می‌شود. */
const MAX_QUERY_RETRIES = 1;

/**
 * آیا این خطا با تلاش مجدد ممکن است حل شود؟
 *
 * تشخیص روی **نوع خطا** است، نه فقط شمارش تلاش:
 * - `SCHEMA_MISMATCH`/`UNKNOWN` سمت کلاینت ساخته می‌شوند (پاسخ با قرارداد
 *   نمی‌خواند) — درخواست دوباره همان پاسخ نادرست را می‌گیرد چون مشکل در
 *   شکل داده است، نه در شبکه.
 * - هر ۴xx یعنی خودِ درخواست غلط است (نامعتبر، دسترسی نداشتن، پیدا
 *   نشدن) — ارسال دوباره‌ی عین همان درخواست همان ۴xx را می‌گیرد.
 * - ۵xx و خطای شبکه واقعاً می‌توانند موقتی باشند — همان چیزی که retry
 *   برایش ساخته شده.
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.code === 'SCHEMA_MISMATCH' || error.code === 'UNKNOWN') return false;
    return error.status < 400 || error.status >= 500;
  }
  return error instanceof NetworkError;
}

/**
 * نقطه‌ی اتصال «نشست منقضی شد» — فعلاً کاری نمی‌کند.
 *
 * FE-027 (مدیریت Session) هنوز ساخته نشده؛ وقتی ساخته شد، همین‌جا logout
 * و redirect به `/login` صدا زده می‌شود. تا آن زمان، QueryClient همین
 * الان با ۴۰۱ درست برخورد می‌کند (retry نمی‌کند) بدون این‌که چیزی درباره‌ی
 * نشست حدس بزند.
 */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function handleGlobalError(error: unknown): void {
  if (error instanceof ApiError && error.status === 401) {
    unauthorizedHandler?.();
  }
}

/**
 * تابع کارخانه، نه singleton — برای تست هر بار یک client تازه و مستقل
 * لازم است، وگرنه state یک تست به تست بعدی نشت می‌کند.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: handleGlobalError }),
    mutationCache: new MutationCache({ onError: handleGlobalError }),
    defaultOptions: {
      queries: {
        retry: (failureCount, error) =>
          isRetryableError(error) && failureCount < MAX_QUERY_RETRIES,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: {
        /*
         * بدون retry خودکار. حتی با Idempotency-Key (FE-007) که تکرار را
         * ایمن می‌کند، retry ساکت پس‌زمینه برای یک نوشتن مالی UX گنگی
         * می‌سازد — کاربر نمی‌داند دوباره‌تلاشی در جریان است یا نه. تلاش
         * مجدد باید آشکار و با تصمیم کاربر باشد: دکمه‌ای که دوباره
         * `useIdempotentSubmit` را با همان کلید صدا می‌زند.
         */
        retry: false,
      },
    },
  });
}
