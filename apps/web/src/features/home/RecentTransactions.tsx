import { ArrowDownLeft, ArrowUpRight, Coins, Recycle } from 'lucide-react';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatJalaliDateTime } from '@/lib/date';
import type { Transaction, TransactionKind } from '@/api/contracts';

/**
 * آخرین معامله‌ها — **فهرست کارتی، نه جدول**.
 *
 * قاعده‌ی ۶ BOOTSTRAP: زیر ۶۴۰px جدول وجود ندارد. جدول روی ۳۶۰ پیکسل
 * یا افقی اسکرول می‌شود یا ستون‌هایش آن‌قدر تنگ می‌شوند که خوانده نشوند.
 * سه تا چهار فیلد کلیدی در یک کارت، جواب درست است.
 */

const KIND_META: Record<TransactionKind, { icon: typeof Coins; label: string }> = {
  sale: { icon: ArrowUpRight, label: 'فروش' },
  purchase: { icon: ArrowDownLeft, label: 'خرید' },
  'second-hand': { icon: Recycle, label: 'دست‌دوم' },
  'coin-sale': { icon: Coins, label: 'سکه' },
};

export function RecentTransactions({ items }: { items: readonly Transaction[] | undefined }) {
  if (!items) return <RecentTransactionsSkeleton />;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground">
          آخرین معامله‌ها
        </CardTitle>
      </CardHeader>

      <CardContent>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            هنوز معامله‌ای ثبت نشده است.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => {
              const { icon: Icon, label } = KIND_META[item.kind];
              return (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
                    aria-hidden="true"
                  >
                    <Icon className="size-5" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.partyName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {label} · {item.title}
                    </p>
                    <p className="text-[0.6875rem] text-muted-foreground">
                      {formatJalaliDateTime(new Date(item.occurredAt))}
                    </p>
                  </div>

                  <AmountDisplay amount={item.amount} signed size="sm" className="shrink-0" />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function RecentTransactionsSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <Skeleton className="h-4 w-32" />
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
