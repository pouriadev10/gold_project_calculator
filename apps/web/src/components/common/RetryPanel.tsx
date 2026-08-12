import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * خطای فشرده برای یک کارت/ویجت داخل grid — نه کل صفحه (آنجا `ErrorState`).
 * جای اسکلت می‌نشیند وقتی query شکست خورده، نه در حال بارگذاری.
 */
export function RetryPanel({
  message = 'دریافت اطلاعات ناموفق بود.',
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center" role="alert">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
        {message}
      </span>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        تلاش دوباره
      </Button>
    </div>
  );
}
