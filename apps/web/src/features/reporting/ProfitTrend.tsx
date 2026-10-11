import { useMemo } from 'react';
import { formatCount } from '@gold/core-calc';
import { useLedgerProfitTrend } from '@/api/queries';
import type { LedgerProfitReportQuery } from '@/api/contracts';
import { RetryPanel } from '@/components/common/RetryPanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { jalaliRangeToHalfOpenIso, jalaliToday, type JalaliDateRange } from '@/lib/jalali';
import { useUnitStore } from '@/stores/unit-store';
import { ProfitTrendChart } from './ProfitTrendChart';
import { planProfitTrend, trendSeries, type TrendGranularity } from './profit-trend';

/**
 * بخش «روند سود» صفحه‌ی گزارش سود — FE-076.
 *
 * بازه‌ی انتخابی را به دوره‌ها تقسیم می‌کند (`planProfitTrend`)، برای هر
 * دوره گزارش سود سرور را می‌گیرد و نمودار سبک را نشان می‌دهد. کلید واحد
 * فقط چهره‌ی سرور را عوض می‌کند و درخواست تازه نمی‌سازد.
 */

const GRANULARITY_LABEL: Record<TrendGranularity, string> = {
  day: 'روزانه',
  week: 'هفتگی',
  month: 'ماهانه',
};

export function ProfitTrend({ range, timeZone }: { range: JalaliDateRange; timeZone: string }) {
  const unit = useUnitStore((state) => state.unit);
  const plan = planProfitTrend(range, jalaliToday(timeZone));
  const queries = (plan?.buckets ?? []).flatMap((bucket): LedgerProfitReportQuery[] => {
    const query = jalaliRangeToHalfOpenIso({ from: bucket.from, to: bucket.to }, timeZone);
    return query === null ? [] : [query];
  });
  const trend = useLedgerProfitTrend(queries);

  const dataKey = trend.data ? JSON.stringify(trend.data) : '';
  const series = useMemo(
    () => (plan && trend.data ? trendSeries(plan.buckets, trend.data, unit) : null),
    // داده با کلید پایدار مقایسه می‌شود تا نمودار در هر رندر از نو رسم نشود.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `plan` از همان بازه‌ای ساخته شده که `dataKey` را داده است
    [dataKey, unit],
  );

  function body() {
    if (plan === null) {
      return (
        <p className="text-sm text-muted-foreground">برای دیدن روند، بازه‌ای بیش از یک روز انتخاب کنید.</p>
      );
    }
    if (trend.isError) {
      return <RetryPanel message="دریافت روند سود ناموفق بود." onRetry={trend.refetch} />;
    }
    if (series === null) {
      return <Skeleton className="h-60 w-full" aria-label="در حال دریافت روند سود" />;
    }
    if (series.total.every((value) => value === 0n) && series.operating.every((value) => value === 0n)) {
      return <p className="text-sm text-muted-foreground">در این دوره‌ها سودی ثبت نشده است.</p>;
    }
    return <ProfitTrendChart series={series} unit={unit} />;
  }

  return (
    <Card>
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="text-sm">روند سود</CardTitle>
        {plan ? (
          <p className="text-xs text-muted-foreground">
            {GRANULARITY_LABEL[plan.granularity]} · {formatCount(plan.buckets.length)} دوره
            {range.from === null && range.to === null ? ' · شش ماه اخیر' : ''}. هر ستون سه منشأ سود
            را جدا نشان می‌دهد و خط، سود کل همان دوره است.
          </p>
        ) : null}
      </CardHeader>
      <CardContent>{body()}</CardContent>
    </Card>
  );
}
