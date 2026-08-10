import { useCallback, useRef, useState } from 'react';
import { newIdempotencyKey } from '@/api/client';

/**
 * کلید Idempotency پایدار برای یک عملیات نوشتنی.
 *
 * یک بار در mount ساخته می‌شود (initializer تنبل `useState`) و تا `reset()`
 * صریح عوض نمی‌شود — نه با rerender، نه با شکست و تلاش مجدد. همین پایداری
 * «تلاش مجدد همان عملیات» را ممکن می‌کند: اگر پاسخ تلاش اول گم شود (نه رد
 * شود، فقط گم شود) و کاربر دوباره بزند، سرور با همان کلید متوجه می‌شود
 * این همان درخواست است، نه یک فاکتور تازه.
 *
 * `reset()` را فقط بعد از یک موفقیت قطعی یا وقتی کاربر عمداً فرم را رها
 * می‌کند صدا بزن — نه بعد از هر شکست. حتی خطای اعتبارسنجی هم دلیلی برای
 * کلید تازه نیست: چیزی هنوز روی سرور ساخته نشده که بخواهد تکراری شود.
 */
export function useIdempotencyKey(): { readonly key: string; readonly reset: () => void } {
  const [key, setKey] = useState(newIdempotencyKey);
  const reset = useCallback(() => setKey(newIdempotencyKey()), []);
  return { key, reset };
}

/**
 * یک عملیات نوشتنی را با کلید پایدار + قفل هم‌زمانی می‌پوشاند.
 *
 * «دکمه‌ی disabled» به‌تنهایی کافی نیست: به‌روزرسانی state ری‌اکت async
 * است و یک ضربه‌ی دوم سریع می‌تواند پیش از رندر حالت غیرفعال از راه
 * برسد. قفل واقعی روی یک `ref` است — سنکرون، بدون فاصله‌ی رندر، پس
 * ضربه‌ی دوم حتی به `action` هم نمی‌رسد.
 *
 * حتی اگر این قفل هم به‌هردلیل رد شود (مثلاً دو تب باز روی یک فرم)، هر دو
 * تلاش همان `key` را حمل می‌کنند؛ سرور (یا cache ساختگی MSW) دومی را به
 * جای نتیجه‌ی اولی برمی‌گرداند، نه اینکه سند دوم بسازد. قفل سرعت را
 * بهتر می‌کند، کلید درستی را تضمین می‌کند.
 */
export function useIdempotentSubmit<TPayload, TResult>(
  action: (key: string, payload: TPayload) => Promise<TResult>,
): {
  readonly submit: (payload: TPayload) => Promise<TResult | undefined>;
  readonly isSubmitting: boolean;
  readonly key: string;
  readonly reset: () => void;
} {
  const { key, reset } = useIdempotencyKey();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inFlight = useRef(false);

  const submit = useCallback(
    async (payload: TPayload): Promise<TResult | undefined> => {
      // ضربه‌ی دوم بی‌اثر می‌ماند — نه خطا، فقط نادیده؛ اولین تلاش هنوز در جریان است
      if (inFlight.current) return undefined;
      inFlight.current = true;
      setIsSubmitting(true);
      try {
        return await action(key, payload);
      } finally {
        inFlight.current = false;
        setIsSubmitting(false);
      }
    },
    [action, key],
  );

  return { submit, isSubmitting, key, reset };
}
