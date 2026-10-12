import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrendSeries } from './profit-trend';
import type { TrendChartModel } from './profit-trend-echarts';
import { ProfitTrendChart, buildTrendChartModel } from './ProfitTrendChart';

/**
 * FE-076 — نمودار تنبل. ماژول ECharts (`profit-trend-echarts`) mock می‌شود؛
 * گزینه‌های خودش در تست جدا سنجیده شده‌اند.
 */

const handle = { update: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
const renderTrendChart = vi.fn((_element: HTMLElement, _model: TrendChartModel) => handle);

vi.mock('./profit-trend-echarts', () => ({
  renderTrendChart: (element: HTMLElement, model: TrendChartModel) => renderTrendChart(element, model),
}));

const SERIES: TrendSeries = {
  labels: ['۱ مهر', '۴ مهر'],
  operating: [1_000_000n, 2_000_000n],
  coinBubble: [100_000n, 0n],
  goldPrice: [-50_000n, 0n],
  total: [1_050_000n, 2_000_000n],
};

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildTrendChartModel', () => {
  it('maps bigint series to numbers only for drawing, with exact formatted text', () => {
    stubReducedMotion(false);
    const model = buildTrendChartModel(SERIES, 'rial')!;
    expect(model.series.map((series) => series.name)).toEqual(['سود عملیاتی', 'اثر حباب سکه', 'اثر نوسان طلا', 'سود کل']);
    expect(model.series[0]!.values).toEqual([1_000_000, 2_000_000]);
    expect(model.series[2]!.formatted[0]).toBe('−۵۰٬۰۰۰ ریال');
    expect(model.series.map((series) => series.kind)).toEqual(['bar', 'bar', 'bar', 'line']);
    expect(model.animation).toBe(true);
  });

  it('turns animation off for reduced motion and formats gold axis exactly', () => {
    stubReducedMotion(true);
    const model = buildTrendChartModel(SERIES, 'gold')!;
    expect(model.animation).toBe(false);
    expect(model.axisLabel(12_500)).toBe('۱۲٫۵۰۰');
    expect(model.axisLabel(0.5)).toBe('');
    expect(model.series[3]!.formatted[1]).toBe('۲٬۰۰۰٫۰۰۰ گرم');
  });

  it('returns null when a value cannot be drawn safely', () => {
    expect(buildTrendChartModel({ ...SERIES, total: [10n ** 20n, 0n] }, 'rial')).toBeNull();
  });
});

describe('ProfitTrendChart', () => {
  it('loads ECharts lazily, draws, keeps a text version and disposes on unmount', async () => {
    const { unmount } = render(<ProfitTrendChart series={SERIES} unit="rial" />);
    expect(screen.getByLabelText('در حال بارگذاری نمودار')).toBeInTheDocument();

    await waitFor(() => expect(renderTrendChart).toHaveBeenCalledTimes(1));
    expect(renderTrendChart.mock.calls[0]![0]).toBe(screen.getByTestId('profit-trend-canvas'));
    await waitFor(() => expect(screen.queryByLabelText('در حال بارگذاری نمودار')).not.toBeInTheDocument());

    const textVersion = screen.getByRole('list', { name: 'روند سود به‌صورت متنی' });
    expect(within(textVersion).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('نمایش متنی روند')).toBeInTheDocument();

    unmount();
    expect(handle.dispose).toHaveBeenCalled();
  });

  it('redraws when the unit changes, without reloading the module', async () => {
    const { rerender } = render(<ProfitTrendChart series={SERIES} unit="rial" />);
    await waitFor(() => expect(renderTrendChart).toHaveBeenCalledTimes(1));

    rerender(<ProfitTrendChart series={SERIES} unit="gold" />);
    // FE-089: رسم دوباره پس از رنگ بعدی است، نه داخل همان رندر
    await waitFor(() =>
      expect(handle.update).toHaveBeenCalledWith(expect.objectContaining({ series: expect.any(Array) })),
    );
    expect(renderTrendChart).toHaveBeenCalledTimes(1);
  });

  it('falls back to the open text version when loading or drawing the chart fails', async () => {
    renderTrendChart.mockImplementationOnce(() => {
      throw new Error('chart failed');
    });
    render(<ProfitTrendChart series={SERIES} unit="rial" />);

    expect(await screen.findByText('نمودار در دسترس نیست؛ روند به‌صورت متنی نمایش داده می‌شود.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'روند سود به‌صورت متنی' })).toBeVisible();
    expect(screen.queryByTestId('profit-trend-canvas')).not.toBeInTheDocument();
  });

  it('falls back immediately when values are too large to draw', () => {
    render(<ProfitTrendChart series={{ ...SERIES, total: [10n ** 20n, 0n] }} unit="rial" />);
    expect(screen.getByText('نمودار در دسترس نیست؛ روند به‌صورت متنی نمایش داده می‌شود.')).toBeInTheDocument();
    expect(renderTrendChart).not.toHaveBeenCalled();
  });
});
