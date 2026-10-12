import { cn } from '@/lib/utils';

/**
 * خطای یک فیلد فرم؛ بلافاصله زیر همان ورودی نمایش داده می‌شود.
 *
 * FE-084: با `id`، ورودی آن را با `aria-describedby` به خودش وصل می‌کند تا
 * صفحه‌خوان هر بار که کاربر به فیلد برمی‌گردد خطا را هم بخواند، نه فقط یک‌بار
 * لحظه‌ی ظاهر شدن (`role="alert"`).
 */
export function InlineError({
  message,
  className,
  id,
}: {
  message: string;
  className?: string | undefined;
  id?: string | undefined;
}) {
  return (
    <p id={id} className={cn('mt-1 text-sm leading-5 text-destructive', className)} role="alert">
      {message}
    </p>
  );
}
