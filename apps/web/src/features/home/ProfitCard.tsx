import { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ProfitBreakdown } from '@/mocks/dashboard';
import { formatScaled } from '@gold/core-calc';

/**
 * کارت سود — امروز و این ماه.
 *
 * تفکیک عملیاتی / نوسان / حباب سکه عمدی است: سه منشأ کاملاً متفاوت‌اند.
 * سود نوسان یعنی بازار بالا رفته، نه اینکه فروشنده خوب کار کرده. اگر
 * این سه با هم جمع شوند، کاربر نمی‌فهمد کدام دستاورد خودش بوده.
 */

type Period = 'today' | 'month';

const PERIOD_LABEL: Record<Period, string> = {
  today: 'امروز',
  month: 'این ماه',
};

export function ProfitCard({
  today,
  month,
}: {
  today: ProfitBreakdown | undefined;
  month: ProfitBreakdown | undefined;
}) {
  const [period, setPeriod] = useState<Period>('month');

  if (!today || !month) return <ProfitCardSkeleton />;

  const data = period === 'today' ? today : month;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground">سود</CardTitle>

        <div
          role="radiogroup"
          aria-label="بازه‌ی زمانی سود"
          className="inline-flex gap-1 rounded-lg bg-muted p-1"
        >
          {(['today', 'month'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={period === value}
              onClick={() => setPeriod(value)}
              className={cn(
                'min-h-touch cursor-pointer rounded-md px-3 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                period === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              {PERIOD_LABEL[value]}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <AmountDisplay amount={data.total} signed size="xl" />
          <span className="inline-flex items-center gap-1 rounded-md bg-credit/10 px-2 py-1 text-xs font-semibold text-credit">
            <TrendingUp className="size-3.5" aria-hidden="true" />
            {formatScaled(data.percentX10, 1)}٪
          </span>
        </div>

        <Separator />

        <dl className="space-y-2">
          <BreakdownRow label="عملیاتی" hint="اجرت و حاشیه فروش" amount={data.operational} />
          <BreakdownRow label="نوسان" hint="تغییر قیمت طلا روی موجودی" amount={data.fluctuation} />
          <BreakdownRow label="حباب سکه" hint="فقط سکه ضرب بانک مرکزی" amount={data.coinBubble} />
        </dl>
      </CardContent>
    </Card>
  );
}

function BreakdownRow({
  label,
  hint,
  amount,
}: {
  label: string;
  hint: string;
  amount: ProfitBreakdown['operational'];
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <dt className="text-sm">{label}</dt>
        <dd className="text-[0.6875rem] text-muted-foreground">{hint}</dd>
      </div>
      <AmountDisplay amount={amount} signed size="sm" />
    </div>
  );
}

export function ProfitCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <Skeleton className="h-4 w-16" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </CardContent>
    </Card>
  );
}
