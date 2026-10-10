import { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useLedgerProfitReport } from '@/api/queries';
import type { LedgerProfitReport, LedgerProfitReportQuery } from '@/api/contracts';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { CardSkeleton } from '@/components/common/CardSkeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { JalaliDateRangeFilter } from '@/components/common/JalaliDateRangeFilter';
import { PageHeader } from '@/components/common/PageHeader';
import { UnitToggle } from '@/components/common/UnitToggle';
import { Card, CardContent } from '@/components/ui/card';
import { useTenantTimeZone } from '@/hooks/useTenantTimeZone';
import {
  formatJalaliDate,
  jalaliPresetRange,
  jalaliRangeToHalfOpenIso,
  type JalaliDateRange,
} from '@/lib/jalali';
import { cn } from '@/lib/utils';
import { UNIT_LABEL, useUnitStore, type MoneyUnit } from '@/stores/unit-store';
import { PROFIT_ROWS, isEmptyProfitReport, measureFace, type ProfitRow } from './profit-report';

/**
 * گزارش سود — FE-075، روی `GET /reporting/profit` (BE-060).
 *
 * داده‌ی محاسبه‌شده‌ی سرور مبناست؛ فرانت فقط سطرها را می‌چیند و رابطه‌ی
 * هر سطر با بقیه را توضیح می‌دهد. هر سنجه هر دو چهره (ریال، طلای معادل)
 * را از سرور دارد و طلای معادل با مظنه‌ی قفل‌شده‌ی هر رویداد ساخته شده،
 * پس کلید واحد فقط چهره را عوض می‌کند و نرخ امروز هرگز جای نرخ تاریخی
 * نمی‌نشیند. اثر حباب فقط همان چیزی است که سرور برای سکه‌ی ضرب بانک
 * مرکزی گزارش می‌دهد؛ برای شمش یا نوع دیگری حبابی نمایش داده نمی‌شود.
 *
 * بازه با فیلتر مشترک شمسی FE-071 و مرز روزِ منطقه‌ی مستأجر انتخاب می‌شود
 * و چون `to` در سرور انحصاری است به شکل نیمه‌باز فرستاده می‌شود. پیش‌فرض
 * «این ماه» است؛ پاک‌کردن بازه یعنی کل دوره. نمودار ندارد (FE-076).
 */

function otherUnit(unit: MoneyUnit): MoneyUnit {
  return unit === 'gold' ? 'rial' : 'gold';
}

function signNote(row: ProfitRow, value: bigint): string | null {
  if (!row.signed || value === 0n) return null;
  if (row.subtotal) return value < 0n ? 'زیان' : 'سود';
  return value < 0n ? 'اثر منفی' : 'اثر مثبت';
}

function ProfitRowView({ row, report }: { row: ProfitRow; report: LedgerProfitReport }) {
  const unit = useUnitStore((state) => state.unit);
  const measure = report[row.key];
  const primary = measureFace(measure, unit);
  const secondaryUnit = otherUnit(unit);
  const note = signNote(row, primary);

  return (
    <li
      className={cn(
        'flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between',
        row.subtotal && 'border-t-2 border-border',
      )}
      data-measure={row.key}
    >
      <div className="min-w-0 space-y-0.5">
        <p className={cn('text-sm', row.subtotal ? 'font-semibold' : 'font-medium')}>{row.label}</p>
        <p className="text-xs leading-5 text-muted-foreground">{row.description}</p>
      </div>
      <div className="min-w-0 shrink-0 space-y-0.5 sm:text-end">
        <AmountDisplay
          amount={{ kind: 'raw', value: primary, unit }}
          signed={row.signed}
          size={row.key === 'totalProfit' ? 'lg' : 'md'}
          className="flex-wrap"
        />
        {note ? <p className="text-xs font-medium">{note}</p> : null}
        <p className="flex flex-wrap items-baseline gap-1 text-xs text-muted-foreground sm:justify-end">
          {UNIT_LABEL[secondaryUnit]}:
          <AmountDisplay
            amount={{ kind: 'raw', value: measureFace(measure, secondaryUnit), unit: secondaryUnit }}
            size="sm"
            showUnit={false}
          />
        </p>
      </div>
    </li>
  );
}

function rangeCaption(range: JalaliDateRange): string {
  if (range.from && range.to) return `${formatJalaliDate(range.from)} تا ${formatJalaliDate(range.to)}`;
  if (range.from) return `از ${formatJalaliDate(range.from)} به بعد`;
  if (range.to) return `تا ${formatJalaliDate(range.to)}`;
  return 'کل دوره';
}

function ProfitResults({ query, range }: { query: LedgerProfitReportQuery; range: JalaliDateRange }) {
  const { data, isLoading, isError, isPlaceholderData, refetch } = useLedgerProfitReport(query);

  if (isLoading) {
    return (
      <div aria-label="در حال دریافت گزارش سود">
        <CardSkeleton lines={6} />
      </div>
    );
  }
  if (isError) {
    return <ErrorState description="دریافت گزارش سود ناموفق بود." onRetry={() => void refetch()} />;
  }
  if (data === undefined) return null;

  if (isEmptyProfitReport(data)) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="سودی در این بازه ثبت نشده"
        description="در این بازه هیچ فاکتور فروش یا خرید دست‌دوم مرتبطی نیست؛ بازه را تغییر دهید."
      />
    );
  }

  return (
    <Card aria-busy={isPlaceholderData} className={isPlaceholderData ? 'opacity-60' : undefined}>
      <CardContent className="space-y-2 pt-6">
        <p className="text-xs text-muted-foreground">بازه: {rangeCaption(range)}</p>
        <ul aria-label="ریز سود">
          {PROFIT_ROWS.map((row) => (
            <ProfitRowView key={row.key} row={row} report={data} />
          ))}
        </ul>
        <p className="text-xs leading-5 text-muted-foreground">
          طلای معادل هر رویداد با مظنه‌ی قفل‌شده‌ی همان رویداد محاسبه شده و با تغییر مظنه‌ی امروز
          عوض نمی‌شود. حباب فقط برای سکه‌های ضرب بانک مرکزی است؛ شمش حباب ندارد.
        </p>
      </CardContent>
    </Card>
  );
}

export default function ProfitReportPage() {
  const timeZone = useTenantTimeZone();
  const [range, setRange] = useState<JalaliDateRange>(() => jalaliPresetRange('month', timeZone));
  const isoRange = jalaliRangeToHalfOpenIso(range, timeZone);

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="گزارش سود">
        <UnitToggle className="shrink-0" />
      </PageHeader>

      <main className="flex-1 space-y-4 p-4 pb-6">
        <section className="space-y-2" aria-label="بازه گزارش">
          <JalaliDateRangeFilter idPrefix="profit-date" value={range} timeZone={timeZone} onChange={setRange} />
        </section>

        {isoRange !== null ? <ProfitResults query={isoRange} range={range} /> : null}
      </main>
    </div>
  );
}
