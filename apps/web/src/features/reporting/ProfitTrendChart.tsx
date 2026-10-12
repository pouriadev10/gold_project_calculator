import { useEffect, useMemo, useRef, useState } from 'react';
import { formatGram, formatRial, toSafeNumber } from '@gold/core-calc';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { Skeleton } from '@/components/ui/skeleton';
import { afterNextPaint } from '@/lib/after-next-paint';
import { UNIT_LABEL, type MoneyUnit } from '@/stores/unit-store';
import type { TrendChartHandle, TrendChartModel } from './profit-trend-echarts';
import type { TrendSeries } from './profit-trend';

/**
 * نمودار روند سود — FE-076.
 *
 * ECharts فقط با `import()` پویا و فقط پس از mount همین کامپوننت بارگذاری
 * می‌شود (`profit-trend-echarts.ts`)، پس وارد بسته‌ی اولیه نمی‌شود. اعداد
 * bigint فقط در مرز ترسیم با `toSafeNumber` به number تبدیل می‌شوند؛ متن
 * دقیق tooltip و فهرست متنی از خود bigint با core-calc ساخته می‌شود.
 *
 * - `prefers-reduced-motion` انیمیشن ECharts را خاموش می‌کند.
 * - tooltip با لمس (click) هم باز می‌شود؛ هیچ اطلاعاتی فقط با hover نیست،
 *   چون فهرست متنی همه‌ی اعداد را هم دارد.
 * - اگر بارگذاری یا ترسیم شکست بخورد، فهرست متنی باز و جایگزین نمودار است.
 */

const SERIES_LABELS = {
  operating: 'سود عملیاتی',
  coinBubble: 'اثر حباب سکه',
  goldPrice: 'اثر نوسان طلا',
  total: 'سود کل',
} as const;

const COMPACT_RIAL = new Intl.NumberFormat('fa-IR', { notation: 'compact' });

function cssColor(token: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value ? `hsl(${value})` : 'currentColor';
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function formatExact(value: bigint, unit: MoneyUnit): string {
  return `${unit === 'gold' ? formatGram(value) : formatRial(value)} ${UNIT_LABEL[unit]}`;
}

/** مدل ترسیم؛ اگر عددی از بازه‌ی امن number بیرون باشد `null` (نمودار کنار می‌رود، متن می‌ماند). */
export function buildTrendChartModel(series: TrendSeries, unit: MoneyUnit): TrendChartModel | null {
  try {
    const line = (key: 'operating' | 'coinBubble' | 'goldPrice' | 'total') => ({
      values: series[key].map(toSafeNumber),
      formatted: series[key].map((value) => formatExact(value, unit)),
    });
    return {
      labels: series.labels,
      series: [
        { name: SERIES_LABELS.operating, kind: 'bar', color: cssColor('--primary'), ...line('operating') },
        { name: SERIES_LABELS.coinBubble, kind: 'bar', color: cssColor('--warning'), ...line('coinBubble') },
        { name: SERIES_LABELS.goldPrice, kind: 'bar', color: cssColor('--muted-foreground'), ...line('goldPrice') },
        { name: SERIES_LABELS.total, kind: 'line', color: cssColor('--foreground'), ...line('total') },
      ],
      axisLabel:
        unit === 'gold'
          ? (value: number) => (Number.isSafeInteger(value) ? formatGram(BigInt(value)) : '')
          : (value: number) => COMPACT_RIAL.format(value),
      animation: !prefersReducedMotion(),
      textColor: cssColor('--muted-foreground'),
      gridColor: cssColor('--border'),
    };
  } catch {
    return null;
  }
}

function TextFallback({ series, unit }: { series: TrendSeries; unit: MoneyUnit }) {
  return (
    <ol className="divide-y divide-border text-sm" aria-label="روند سود به‌صورت متنی">
      {series.labels.map((label, index) => (
        <li key={label + index} className="space-y-1 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{label}</span>
            <AmountDisplay amount={{ kind: 'raw', value: series.total[index] ?? 0n, unit }} size="sm" signed />
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-xs text-muted-foreground">
            <dt>{SERIES_LABELS.operating}</dt>
            <dd className="text-end">
              <AmountDisplay amount={{ kind: 'raw', value: series.operating[index] ?? 0n, unit }} size="sm" showUnit={false} />
            </dd>
            <dt>{SERIES_LABELS.coinBubble}</dt>
            <dd className="text-end">
              <AmountDisplay amount={{ kind: 'raw', value: series.coinBubble[index] ?? 0n, unit }} size="sm" showUnit={false} />
            </dd>
            <dt>{SERIES_LABELS.goldPrice}</dt>
            <dd className="text-end">
              <AmountDisplay amount={{ kind: 'raw', value: series.goldPrice[index] ?? 0n, unit }} size="sm" showUnit={false} />
            </dd>
          </dl>
        </li>
      ))}
    </ol>
  );
}

export function ProfitTrendChart({ series, unit }: { series: TrendSeries; unit: MoneyUnit }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<TrendChartHandle | null>(null);
  const model = useMemo(() => buildTrendChartModel(series, unit), [series, unit]);
  const modelRef = useRef(model);
  modelRef.current = model;
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(model === null ? 'failed' : 'loading');

  useEffect(() => {
    let cancelled = false;
    const element = containerRef.current;
    if (element === null || modelRef.current === null) return undefined;

    import('./profit-trend-echarts')
      .then(({ renderTrendChart }) => {
        const current = modelRef.current;
        if (cancelled || current === null) return;
        handleRef.current = renderTrendChart(element, current);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('failed');
      });

    const onResize = () => handleRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, []);

  // FE-089: رسم دوباره‌ی ECharts روی CPU ×۴ ~۱۵۰ms است؛ اگر همین‌جا اجرا شود جزو INP
  // ضربه‌ی کلید طلا/ریال می‌شود. کلید و اعداد متنی اول رنگ می‌گیرند، نمودار بلافاصله بعد.
  useEffect(() => {
    if (model === null) {
      setStatus('failed');
      return undefined;
    }
    return afterNextPaint(() => handleRef.current?.update(model));
  }, [model]);

  const failed = status === 'failed';

  return (
    <figure className="space-y-2">
      {failed ? (
        <p className="text-xs text-muted-foreground" role="status">
          نمودار در دسترس نیست؛ روند به‌صورت متنی نمایش داده می‌شود.
        </p>
      ) : (
        <div className="relative">
          <div ref={containerRef} className="h-60 w-full" aria-hidden="true" data-testid="profit-trend-canvas" />
          {status === 'loading' ? <Skeleton className="absolute inset-0" aria-label="در حال بارگذاری نمودار" /> : null}
        </div>
      )}
      <figcaption className="sr-only">روند سود؛ همه‌ی اعداد در فهرست متنی زیر هم آمده‌اند.</figcaption>
      {failed ? (
        <TextFallback series={series} unit={unit} />
      ) : (
        <details className="rounded-md border border-border px-3">
          <summary className="flex min-h-touch cursor-pointer items-center text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            نمایش متنی روند
          </summary>
          <TextFallback series={series} unit={unit} />
        </details>
      )}
    </figure>
  );
}
