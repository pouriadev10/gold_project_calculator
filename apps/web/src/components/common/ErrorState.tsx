import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * خطای سطح صفحه/بخش — بزرگ‌تر از `RetryPanel`. برای شکست کل یک صفحه یا
 * بخش بزرگ، نه یک کارت کوچک داخل grid (آنجا `RetryPanel` مناسب‌تر است).
 */
export function ErrorState({
  title = 'مشکلی پیش آمد',
  description,
  onRetry,
}: {
  title?: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center" role="alert">
      <span
        className="grid size-14 place-items-center rounded-full bg-destructive/10 text-destructive"
        aria-hidden="true"
      >
        <AlertTriangle className="size-7" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
      </div>
      {onRetry ? (
        <Button type="button" variant="outline" onClick={onRetry}>
          تلاش دوباره
        </Button>
      ) : null}
    </div>
  );
}
