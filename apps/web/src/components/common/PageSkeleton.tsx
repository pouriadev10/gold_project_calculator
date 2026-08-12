import { CardSkeleton } from '@/components/common/CardSkeleton';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * اسکلت یک صفحه‌ی کامل — هدر فشرده + چند کارت. برای صفحات فهرستی آینده
 * (اشخاص، موجودی، گزارش‌ها) که کل صفحه یک‌جا از API می‌آید، نه برای
 * ویجت‌های داخل داشبورد که اسکلت مخصوص خودشان را دارند.
 */
export function PageSkeleton({ cardCount = 3 }: { cardCount?: number }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="sticky top-0 z-30 border-b border-border bg-card px-4 py-3">
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="flex-1 space-y-4 p-4">
        {Array.from({ length: cardCount }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
