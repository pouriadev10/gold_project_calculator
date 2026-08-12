import { Loader2 } from 'lucide-react';

/** بارگذاری تمام‌صفحه — برای گذار مسیرها (chunk تنبل) و گیت‌های سراسری. */
export function FullPageLoading({ label = 'در حال بارگذاری…' }: { label?: string }) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-3"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
