import { CardSkeleton } from '@/components/common/CardSkeleton';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * اسکلت یک صفحه‌ی کامل — هدر فشرده + چند کارت. برای صفحات فهرستی (اشخاص، موجودی،
 * گزارش‌ها) که کل صفحه یک‌جا از API می‌آید، نه برای ویجت‌های داخل داشبورد که اسکلت
 * مخصوص خودشان را دارند.
 *
 * FE-088: همین اسکلت `defaultPendingComponent` روتر هم هست — وقتی چانک تنبل یک مسیر
 * روی شبکه‌ی ضعیف بیش از `pendingMs` طول بکشد، کاربر شکل صفحه را می‌بیند نه یک اسپینر
 * وسط صفحه‌ی خالی. برای صفحه‌خوان یک `role="status"` با متن پنهان دارد.
 */
export function PageSkeleton({ cardCount = 3 }: { cardCount?: number }) {
  return (
    <div className="flex min-h-dvh flex-col" role="status" aria-live="polite">
      <span className="sr-only">در حال بارگذاری…</span>
      <div className="sticky top-0 z-30 border-b border-border bg-card px-4 py-3" aria-hidden="true">
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="flex-1 space-y-4 p-4" aria-hidden="true">
        {Array.from({ length: cardCount }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
