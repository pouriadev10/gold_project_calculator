import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * اسکلت یک کارت عمومی — برای فهرست‌هایی که هنوز کارت اختصاصی ندارند.
 * کارت‌های دارای شکل خاص (مثل `BalanceCard`) اسکلت خودشان را نگه
 * می‌دارند تا ابعادشان با محتوای واقعی یکی بماند و layout shift نسازد.
 */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <Skeleton className="h-4 w-28" />
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={i === lines - 1 ? 'h-4 w-2/3' : 'h-4 w-full'} />
        ))}
      </CardContent>
    </Card>
  );
}
