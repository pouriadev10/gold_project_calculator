import { Wifi, WifiOff } from 'lucide-react';
import { RateDisplay } from '@/components/common/AmountDisplay';
import { Skeleton } from '@/components/ui/skeleton';
import { formatJalaliDistance } from '@/lib/date';

import { cn } from '@/lib/utils';
import { useMazneh } from './useMazneh';

/**
 * نوار مظنه — چسبیده به بالای صفحه.
 *
 * برچسب زمان **همیشه** دیده می‌شود. اگر کاربر نداند عدد مال کی است،
 * یک بار روی قیمت کهنه معامله می‌کند و دیگر برنمی‌گردد.
 */
export function MaznehBar({ isOnline }: { isOnline: boolean }) {
  const { data, isLoading } = useMazneh();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h1 className="text-sm font-bold text-foreground">مظنه بازار</h1>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-xs',
            isOnline ? 'text-credit' : 'text-muted-foreground',
          )}
        >
          {isOnline ? (
            <Wifi className="size-3.5" aria-hidden="true" />
          ) : (
            <WifiOff className="size-3.5" aria-hidden="true" />
          )}
          {isOnline ? 'آنلاین' : 'آفلاین'}
        </span>
      </div>

      <div className="flex gap-3 overflow-x-auto px-4 pb-3 pt-2">
        {isLoading || !data ? (
          <>
            <Skeleton className="h-14 w-36 shrink-0 rounded-lg" />
            <Skeleton className="h-14 w-36 shrink-0 rounded-lg" />
            <Skeleton className="h-14 w-36 shrink-0 rounded-lg" />
          </>
        ) : (
          <>
            <RateCell label="مظنه مثقال" value={data.mazneh} />
            <RateCell label="گرم ۷۵۰" value={data.gram750} />
            <RateCell label="سکه تمام" value={data.fullCoinPrice} />
          </>
        )}
      </div>

      {data ? (
        <p className="px-4 pb-2 text-[0.6875rem] text-muted-foreground">
          آخرین به‌روزرسانی: {formatJalaliDistance(data.fetchedAt)}
        </p>
      ) : null}
    </header>
  );
}

function RateCell({ label, value }: { label: string; value: bigint }) {
  return (
    <div className="shrink-0 rounded-lg bg-muted px-3 py-2">
      <p className="text-[0.6875rem] text-muted-foreground">{label}</p>
      <RateDisplay value={value} size="sm" />
    </div>
  );
}
