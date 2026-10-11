import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerProfitReport, LedgerProfitReportQuery } from '@/api/contracts';
import type * as Queries from '@/api/queries';
import { useUnitStore } from '@/stores/unit-store';
import type { TrendSeries } from './profit-trend';
import { ProfitTrend } from './ProfitTrend';

/** FE-076 — بخش روند سود. hook و نمودار mock می‌شوند. */

const useLedgerProfitTrendMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useLedgerProfitTrend: (...args: unknown[]) => useLedgerProfitTrendMock(...args),
}));

const chartProps = vi.fn();
vi.mock('./ProfitTrendChart', () => ({
  ProfitTrendChart: (props: { series: TrendSeries; unit: string }) => {
    chartProps(props);
    return <div data-testid="chart">{props.unit}</div>;
  },
}));

const TEHRAN = 'Asia/Tehran';
const NOW = new Date('2026-10-12T08:00:00.000Z'); // ۲۰ مهر ۱۴۰۵
const MONTH = { from: { year: 1405, month: 7, day: 1 }, to: { year: 1405, month: 7, day: 30 } };

function report(totalRial: string, totalGold: string): LedgerProfitReport {
  const m = (rial: string, gold: string) => ({ rial, goldEquivalentMg: gold });
  return {
    from: null,
    to: null,
    revenue: m('0', '0'),
    costOfGoods: m('0', '0'),
    grossProfit: m('0', '0'),
    operatingProfit: m(totalRial, totalGold),
    coinBubbleEffect: m('0', '0'),
    goldPriceEffect: m('0', '0'),
    totalProfit: m(totalRial, totalGold),
  };
}

function queries(): LedgerProfitReportQuery[] {
  return useLedgerProfitTrendMock.mock.calls.at(-1)?.[0] as LedgerProfitReportQuery[];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  useUnitStore.setState({ unit: 'gold' });
  useLedgerProfitTrendMock.mockReset();
  chartProps.mockReset();
  useLedgerProfitTrendMock.mockReturnValue({
    data: Array.from({ length: 5 }, (_, index) => report(String((index + 1) * 1_000_000), String((index + 1) * 200))),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ProfitTrend — FE-076', () => {
  it('asks one half-open server report per weekly bucket in the tenant timezone', () => {
    render(<ProfitTrend range={MONTH} timeZone={TEHRAN} />);

    expect(queries()).toHaveLength(5);
    // ۱ تا ۳ مهر (چهارشنبه تا جمعه)، سپس هفته‌ی ۴ تا ۱۰ مهر.
    expect(queries()[0]).toEqual({ from: '2026-09-22T20:30:00.000Z', to: '2026-09-25T20:30:00.000Z' });
    expect(queries()[1]).toEqual({ from: '2026-09-25T20:30:00.000Z', to: '2026-10-02T20:30:00.000Z' });
    expect(screen.getByText(/هفتگی · ۵ دوره/)).toBeInTheDocument();
  });

  it('passes the server faces for the active unit; toggling does not change the requests', async () => {
    const user = userEvent.setup();
    const { UnitToggle } = await import('@/components/common/UnitToggle');
    render(
      <>
        <UnitToggle />
        <ProfitTrend range={MONTH} timeZone={TEHRAN} />
      </>,
    );

    const goldSeries = chartProps.mock.calls.at(-1)![0].series as TrendSeries;
    expect(goldSeries.total).toEqual([200n, 400n, 600n, 800n, 1000n]);

    const requestsBefore = JSON.stringify(queries());
    await user.click(screen.getByRole('radio', { name: /ریال/ }));
    const rialSeries = chartProps.mock.calls.at(-1)![0].series as TrendSeries;
    expect(rialSeries.total[0]).toBe(1_000_000n);
    expect(chartProps.mock.calls.at(-1)![0].unit).toBe('rial');
    expect(JSON.stringify(queries())).toBe(requestsBefore);
  });

  it('explains when a one-day range has no trend, and labels the default six months', () => {
    const { rerender } = render(
      <ProfitTrend range={{ from: MONTH.from, to: MONTH.from }} timeZone={TEHRAN} />,
    );
    expect(screen.getByText('برای دیدن روند، بازه‌ای بیش از یک روز انتخاب کنید.')).toBeInTheDocument();
    expect(queries()).toEqual([]);

    rerender(<ProfitTrend range={{ from: null, to: null }} timeZone={TEHRAN} />);
    expect(screen.getByText(/ماهانه · ۶ دوره · شش ماه اخیر/)).toBeInTheDocument();
  });

  it('shows loading, error with retry, and an all-zero message instead of an empty chart', async () => {
    useLedgerProfitTrendMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    const { rerender } = render(<ProfitTrend range={MONTH} timeZone={TEHRAN} />);
    expect(screen.getByLabelText('در حال دریافت روند سود')).toBeInTheDocument();

    const refetch = vi.fn();
    useLedgerProfitTrendMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    rerender(<ProfitTrend range={MONTH} timeZone={TEHRAN} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /تلاش/ }));
    expect(refetch).toHaveBeenCalled();

    useLedgerProfitTrendMock.mockReturnValue({
      data: Array.from({ length: 5 }, () => report('0', '0')),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    rerender(<ProfitTrend range={MONTH} timeZone={TEHRAN} />);
    expect(screen.getByText('در این دوره‌ها سودی ثبت نشده است.')).toBeInTheDocument();
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  });
});
