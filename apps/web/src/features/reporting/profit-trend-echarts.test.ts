import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrendChartModel } from './profit-trend-echarts';

/**
 * FE-076 — گزینه‌های ECharts. `echarts/core` mock می‌شود تا option واقعی
 * که به `setOption` می‌رسد بدون بوم سنجیده شود.
 */

const setOption = vi.fn();
const resize = vi.fn();
const dispose = vi.fn();
const init = vi.fn(() => ({ setOption, resize, dispose }));
const use = vi.fn();

vi.mock('echarts/core', () => ({ init, use }));
vi.mock('echarts/charts', () => ({ BarChart: 'BarChart', LineChart: 'LineChart' }));
vi.mock('echarts/components', () => ({
  GridComponent: 'GridComponent',
  TooltipComponent: 'TooltipComponent',
  LegendComponent: 'LegendComponent',
}));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: 'CanvasRenderer' }));

function model(overrides: Partial<TrendChartModel> = {}): TrendChartModel {
  return {
    labels: ['مهر', '<آبان>'],
    series: [
      { name: 'سود عملیاتی', kind: 'bar', color: 'red', values: [1, 2], formatted: ['۱ ریال', '۲ ریال'] },
      { name: 'سود کل', kind: 'line', color: 'black', values: [1, -2], formatted: ['۱ ریال', '−۲ ریال'] },
    ],
    axisLabel: (value) => String(value),
    animation: true,
    textColor: 'gray',
    gridColor: 'silver',
    ...overrides,
  };
}

type Option = {
  animation: boolean;
  xAxis: { inverse: boolean; data: string[] };
  yAxis: { position: string };
  tooltip: { triggerOn: string; confine: boolean; formatter: (params: unknown) => string };
  series: { type: string; stack?: string; stackStrategy?: string; data: number[] }[];
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('renderTrendChart', () => {
  it('registers only the needed ECharts parts and builds an RTL, touch-friendly option', async () => {
    const { renderTrendChart } = await import('./profit-trend-echarts');
    const element = document.createElement('div');
    renderTrendChart(element, model());

    expect(use).toHaveBeenCalledWith([
      'BarChart',
      'LineChart',
      'GridComponent',
      'TooltipComponent',
      'LegendComponent',
      'CanvasRenderer',
    ]);
    expect(init).toHaveBeenCalledWith(element, undefined, { renderer: 'canvas' });
    const option = setOption.mock.calls[0]![0] as Option;
    expect(option.animation).toBe(true);
    expect(option.xAxis.inverse).toBe(true);
    expect(option.yAxis.position).toBe('right');
    expect(option.tooltip.triggerOn).toContain('click');
    expect(option.tooltip.confine).toBe(true);
    expect(option.series[0]).toMatchObject({ type: 'bar', stack: 'profit', stackStrategy: 'samesign', data: [1, 2] });
    expect(option.series[1]).toMatchObject({ type: 'line', data: [1, -2] });
  });

  it('tooltip shows the exact formatted values and escapes text', async () => {
    const { renderTrendChart } = await import('./profit-trend-echarts');
    renderTrendChart(document.createElement('div'), model());
    const option = setOption.mock.calls[0]![0] as Option;

    const html = option.tooltip.formatter([{ dataIndex: 1, seriesIndex: 0 }]);
    expect(html).toContain('&#60;آبان&#62;');
    expect(html).toContain('−۲ ریال');
    expect(html).not.toContain('<آبان>');
    expect(option.tooltip.formatter([])).toBe('');
  });

  it('respects reduced motion and forwards update, resize and dispose', async () => {
    const { renderTrendChart } = await import('./profit-trend-echarts');
    const handle = renderTrendChart(document.createElement('div'), model({ animation: false }));
    expect((setOption.mock.calls[0]![0] as Option).animation).toBe(false);

    handle.update(model({ labels: ['آذر', 'دی'] }));
    expect(setOption).toHaveBeenLastCalledWith(expect.objectContaining({ xAxis: expect.objectContaining({ data: ['آذر', 'دی'] }) }), {
      notMerge: true,
    });
    handle.resize();
    handle.dispose();
    expect(resize).toHaveBeenCalled();
    expect(dispose).toHaveBeenCalled();
  });
});
