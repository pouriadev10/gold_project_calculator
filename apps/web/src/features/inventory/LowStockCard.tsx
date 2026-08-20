import { Gem, PackageSearch } from 'lucide-react';
import { formatCoinCount } from '@gold/core-calc';
import { EmptyState } from '@/components/common/EmptyState';
import { RetryPanel } from '@/components/common/RetryPanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * اقلام کم‌موجود — FE-040.
 *
 * «کم» یک آستانه‌ی نمایشی است، نه یک قاعده‌ی حسابداری یا تنظیم مستأجر —
 * دقیقاً همان استدلال `STALE_THRESHOLD_MS` در `useMazneh.ts`: این عدد
 * هیچ مبلغ فاکتور را تغییر نمی‌دهد، فقط یک نشان بصری است. تبدیل به
 * تنظیم قابل‌تغییر هر مستأجر (قاعده‌ی ۲-۶ CLAUDE.md) در صورت نیاز، کار
 * فازهای بعد است.
 *
 * زیورآلات و سکه با هم رتبه‌بندی می‌شوند (هر دو «تعداد قطعه»‌اند)، ولی
 * آبشده اینجا نیست — آبشده وزن است، نه شمارشی، پس «کم‌موجود» برایش
 * مقایسه‌پذیر نیست (قاعده‌ی ۲-۲ CLAUDE.md).
 */
export const LOW_STOCK_THRESHOLD = 3;

export interface LowStockItem {
  readonly kind: 'JEWELRY' | 'COIN';
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

export function LowStockCard({
  items,
  isError,
  onRetry,
}: {
  items: readonly LowStockItem[] | undefined;
  isError?: boolean;
  onRetry?: () => void;
}) {
  if (isError && onRetry) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground">اقلام کم‌موجود</CardTitle>
        </CardHeader>
        <CardContent>
          <RetryPanel message="دریافت موجودی ناموفق بود." onRetry={onRetry} />
        </CardContent>
      </Card>
    );
  }

  if (!items) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-28" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground">اقلام کم‌موجود</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title="موجودی کم نیست"
            description={`هیچ کالایی با تعداد ${formatCoinCount(LOW_STOCK_THRESHOLD)} یا کمتر پیدا نشد.`}
          />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="flex items-center gap-3 py-2.5">
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive"
                  aria-hidden="true"
                >
                  <Gem className="size-4" />
                </span>
                <p className="min-w-0 flex-1 truncate text-sm">{item.label}</p>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-destructive">
                  {formatCoinCount(item.count)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
