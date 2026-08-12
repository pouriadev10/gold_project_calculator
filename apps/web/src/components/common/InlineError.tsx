import { cn } from '@/lib/utils';

/** خطای یک فیلد فرم؛ بلافاصله زیر همان ورودی نمایش داده می‌شود. */
export function InlineError({
  message,
  className,
}: {
  message: string;
  className?: string | undefined;
}) {
  return (
    <p className={cn('mt-1 text-sm leading-5 text-destructive', className)} role="alert">
      {message}
    </p>
  );
}
