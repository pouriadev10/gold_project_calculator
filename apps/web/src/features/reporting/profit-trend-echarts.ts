import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

/**
 * تنها فایلی که ECharts را وارد می‌کند — FE-076.
 *
 * `ProfitTrendChart` این ماژول را با `import()` پویا صدا می‌زند، پس Rollup
 * آن را در چانک تنبل جدا می‌گذارد: نه در بسته‌ی اولیه، نه حتی در چانک
 * صفحه‌ی گزارش سود تا وقتی نمودار واقعاً رندر شود. فقط همان قطعه‌های لازم
 * ثبت می‌شوند (core + bar/line + grid/tooltip/legend + canvas)، نه کل
 * کتابخانه. API مستقیم ECharts به‌کار رفته، نه `echarts-for-react` (ناسازگار
 * با StrictMode؛ توضیح در `SmokePage.tsx`).
 */

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export interface TrendChartSeries {
  readonly name: string;
  readonly kind: 'bar' | 'line';
  readonly color: string;
  /** فقط برای ترسیم — مقدار دقیق در `formatted` است. */
  readonly values: readonly number[];
  /** متن دقیق هر نقطه، از bigint ساخته‌شده با core-calc. */
  readonly formatted: readonly string[];
}

export interface TrendChartModel {
  readonly labels: readonly string[];
  readonly series: readonly TrendChartSeries[];
  readonly axisLabel: (value: number) => string;
  readonly animation: boolean;
  readonly textColor: string;
  readonly gridColor: string;
}

export interface TrendChartHandle {
  update: (model: TrendChartModel) => void;
  resize: () => void;
  dispose: () => void;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (char) => `&#${char.charCodeAt(0)};`);
}

function toOption(model: TrendChartModel): echarts.EChartsCoreOption {
  return {
    animation: model.animation,
    textStyle: { fontFamily: 'Vazirmatn, system-ui, sans-serif', color: model.textColor },
    grid: { top: 36, right: 8, bottom: 8, left: 8, containLabel: true },
    legend: { top: 0, right: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: model.textColor } },
    tooltip: {
      trigger: 'axis',
      // لمس روی موبایل «click» است؛ روی دسکتاپ حرکت ماوس هم کار می‌کند.
      triggerOn: 'mousemove|click',
      confine: true,
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const items = Array.isArray(params) ? (params as { dataIndex: number; seriesIndex: number }[]) : [];
        const first = items[0];
        if (!first) return '';
        const rows = model.series.map(
          (series) =>
            `<div style="display:flex;justify-content:space-between;gap:12px"><span>${escapeHtml(series.name)}</span><span dir="ltr">${escapeHtml(series.formatted[first.dataIndex] ?? '')}</span></div>`,
        );
        return `<div dir="rtl" style="text-align:right"><strong>${escapeHtml(model.labels[first.dataIndex] ?? '')}</strong>${rows.join('')}</div>`;
      },
    },
    xAxis: {
      type: 'category',
      data: [...model.labels],
      // راست‌به‌چپ: قدیمی‌ترین دوره سمت راست.
      inverse: true,
      axisLabel: { hideOverlap: true, color: model.textColor },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      position: 'right',
      axisLabel: { formatter: model.axisLabel, color: model.textColor },
      splitLine: { lineStyle: { color: model.gridColor } },
    },
    series: model.series.map((series) =>
      series.kind === 'bar'
        ? {
            name: series.name,
            type: 'bar',
            stack: 'profit',
            stackStrategy: 'samesign',
            itemStyle: { color: series.color },
            data: [...series.values],
          }
        : {
            name: series.name,
            type: 'line',
            symbolSize: 6,
            itemStyle: { color: series.color },
            lineStyle: { color: series.color, width: 2 },
            data: [...series.values],
          },
    ),
  };
}

export function renderTrendChart(element: HTMLElement, model: TrendChartModel): TrendChartHandle {
  const chart = echarts.init(element, undefined, { renderer: 'canvas' });
  chart.setOption(toOption(model));
  return {
    update: (next) => chart.setOption(toOption(next), { notMerge: true }),
    resize: () => chart.resize(),
    dispose: () => chart.dispose(),
  };
}
