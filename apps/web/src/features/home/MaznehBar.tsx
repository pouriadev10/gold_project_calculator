import { Link } from '@tanstack/react-router';
import { AlertTriangle, PenLine, Wifi, WifiOff } from 'lucide-react';
import { RateDisplay } from '@/components/common/AmountDisplay';
import { RequireRole } from '@/components/common/RequireRole';
import { RetryPanel } from '@/components/common/RetryPanel';
import { Skeleton } from '@/components/ui/skeleton';
import { formatJalaliDistance } from '@/lib/date';
import { MANUAL_QUOTE_ENTRY_ROLES } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { useMazneh } from './useMazneh';

/**
 * نوار مظنه — چسبیده به بالای صفحه — FE-029.
 *
 * برچسب زمان **همیشه** دیده می‌شود. اگر کاربر نداند عدد مال کی است،
 * یک بار روی قیمت کهنه معامله می‌کند و دیگر برنمی‌گردد.
 *
 * فقط مظنه‌ی خام و نرخ گرم را نشان می‌دهد؛ برخلاف نسخه‌ی MSW-محور قبلی،
 * دیگر سکه‌ای اینجا نیست — `PriceQuote` واقعی (BE-021) فقط `MAZNEH`
 * دارد، قیمت بازار سکه (با حباب) منبع دیگری لازم دارد که فاز ۱ ندارد.
 *
 * شکست دریافت مظنه فقط خودِ این ویجت را تحت تأثیر قرار می‌دهد — بقیه‌ی
 * صفحه (مانده، سود، دکمه‌های فروش/خرید) کاملاً مستقل و قابل‌استفاده
 * می‌ماند؛ قاعده‌ی «قطع فید معامله را متوقف نکند».
 */

const SOURCE_LABEL = { MANUAL: 'دستی', FEED: 'فید' } as const;

export function MaznehBar({ isOnline }: { isOnline: boolean }) {
  const { data, isLoading, isError, isEmpty, refetch } = useMazneh();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h1 className="text-sm font-bold text-foreground">مظنه بازار</h1>
        <div className="flex items-center gap-3">
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
          {/* فقط OWNER/MANAGER — همان نقش‌هایی که POST /pricing/quotes/manual اجازه می‌دهد */}
          <RequireRole roles={MANUAL_QUOTE_ENTRY_ROLES}>
            <Link
              to="/pricing"
              className="inline-flex min-h-touch cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <PenLine className="size-3.5" aria-hidden="true" />
              ثبت دستی
            </Link>
          </RequireRole>
        </div>
      </div>

      <div className="px-4 pb-3 pt-2">
        {isLoading ? (
          <div className="flex gap-3 overflow-x-auto">
            <Skeleton className="h-14 w-36 shrink-0 rounded-lg" />
            <Skeleton className="h-14 w-36 shrink-0 rounded-lg" />
          </div>
        ) : isError ? (
          <RetryPanel message="دریافت مظنه ناموفق بود." onRetry={() => void refetch()} />
        ) : isEmpty ? (
          <p className="py-2 text-center text-sm text-muted-foreground">
            هنوز مظنه‌ای ثبت نشده است.
          </p>
        ) : data ? (
          <>
            <div className="flex gap-3 overflow-x-auto">
              <RateCell label="مظنه مثقال" value={data.mazneh} />
              <RateCell label="گرم ۷۵۰" value={data.gram750} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
              {data.isStale ? (
                <span className="inline-flex items-center gap-1 font-medium text-warning">
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  مظنه قدیمی است
                </span>
              ) : null}
              <span>منبع: {SOURCE_LABEL[data.source]}</span>
              <span>آخرین به‌روزرسانی: {formatJalaliDistance(data.observedAt)}</span>
            </div>
          </>
        ) : null}
      </div>
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
