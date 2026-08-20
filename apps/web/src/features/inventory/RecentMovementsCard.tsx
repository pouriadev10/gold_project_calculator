import { ArrowDownLeft, ArrowUpRight, History, PackagePlus, Wrench } from 'lucide-react';
import { formatCoinCount, formatGram, toSafeNumber } from '@gold/core-calc';
import { EmptyState } from '@/components/common/EmptyState';
import { RetryPanel } from '@/components/common/RetryPanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatJalaliDistance } from '@/lib/date';
import type { RecentInventoryMovement, RecentInventoryMovementSource } from '@/api/contracts';

/**
 * آخرین حرکات موجودی — FE-040.
 *
 * الگوی کارتی دقیقاً از `RecentTransactions.tsx` (خانه) وام گرفته شده —
 * زیر ۶۴۰px جدول نیست (بخش ۶ CLAUDE.md). آیکون بر اساس `sourceType` است
 * (کاربر می‌پرسد «این حرکت از کجا آمد»)، نه `itemType`.
 *
 * مقدار با علامت نمایش داده می‌شود (`quantity` در `recentInventoryMovementSchema`
 * علامت‌دار است) ولی از `formatGram`/`formatCoinCount` می‌گذرد، نه
 * `AmountDisplay` — این وزن/تعداد کالاست، نه مبلغ دومقیاسه‌ی ریال/طلا.
 */

const SOURCE_META: Record<RecentInventoryMovementSource, { icon: typeof History; label: string }> = {
  SALE: { icon: ArrowUpRight, label: 'فروش' },
  PURCHASE: { icon: ArrowDownLeft, label: 'خرید' },
  OPENING_BALANCE: { icon: PackagePlus, label: 'افتتاحیه' },
  CORRECTION: { icon: Wrench, label: 'اصلاح' },
};

function formatQuantity(movement: RecentInventoryMovement): string {
  const value = BigInt(movement.quantity);
  const sign = value > 0n ? '+' : '';
  if (movement.itemType === 'MELTED_GOLD') return `${sign}${formatGram(value)} گرم`;
  return `${sign}${formatCoinCount(toSafeNumber(value))} عدد`;
}

export function RecentMovementsCard({
  items,
  isError,
  onRetry,
}: {
  items: readonly RecentInventoryMovement[] | undefined;
  isError?: boolean;
  onRetry?: () => void;
}) {
  if (isError && onRetry) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground">آخرین حرکات</CardTitle>
        </CardHeader>
        <CardContent>
          <RetryPanel message="دریافت آخرین حرکات ناموفق بود." onRetry={onRetry} />
        </CardContent>
      </Card>
    );
  }

  if (!items) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-24" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground">آخرین حرکات</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState icon={History} title="هنوز حرکتی ثبت نشده" description="حرکت‌های موجودی همین‌جا نشان داده می‌شوند." />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => {
              const { icon: Icon, label } = SOURCE_META[item.sourceType];
              return (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
                    aria-hidden="true"
                  >
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.itemLabel}</p>
                    <p className="truncate text-xs text-muted-foreground">{label}</p>
                    <p className="text-[0.6875rem] text-muted-foreground">
                      {formatJalaliDistance(new Date(item.occurredAt))}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{formatQuantity(item)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
