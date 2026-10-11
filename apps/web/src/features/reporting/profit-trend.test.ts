import { describe, expect, it } from 'vitest';
import type { LedgerProfitReport } from '@/api/contracts';
import { planProfitTrend, resolveTrendRange, trendSeries } from './profit-trend';

/** FE-076 — تقسیم بازه به دوره‌ها و سری‌های نمودار. */

const TODAY = { year: 1405, month: 7, day: 20 }; // دوشنبه

function d(year: number, month: number, day: number) {
  return { year, month, day };
}

describe('planProfitTrend', () => {
  it('بازه‌ی یک‌روزه روند ندارد', () => {
    expect(planProfitTrend({ from: TODAY, to: TODAY }, TODAY)).toBeNull();
    // فقط «از» در آینده: تا امروز می‌رسد ولی کوتاه‌تر از دو روز است.
    expect(planProfitTrend({ from: d(1405, 7, 25), to: null }, TODAY)).toBeNull();
  });

  it('تا ۷ روز روزانه است', () => {
    const plan = planProfitTrend({ from: d(1405, 7, 18), to: d(1405, 7, 24) }, TODAY);
    expect(plan?.granularity).toBe('day');
    expect(plan?.buckets).toHaveLength(7);
    expect(plan?.buckets[0]).toEqual({ from: d(1405, 7, 18), to: d(1405, 7, 18), label: '۱۸ مهر' });
  });

  it('تا ۹۲ روز هفتگی از شنبه تا جمعه، بریده به مرز بازه', () => {
    // ۱ مهر ۱۴۰۵ چهارشنبه است؛ اولین هفته ۱ تا ۳ مهر (جمعه) است.
    const plan = planProfitTrend({ from: d(1405, 7, 1), to: d(1405, 7, 30) }, TODAY);
    expect(plan?.granularity).toBe('week');
    expect(plan?.buckets.map((bucket) => [bucket.from.day, bucket.to.day])).toEqual([
      [1, 3],
      [4, 10],
      [11, 17],
      [18, 24],
      [25, 30],
    ]);
    // پیوسته و بدون هم‌پوشانی.
    expect(plan?.buckets.at(-1)?.to).toEqual(d(1405, 7, 30));
  });

  it('بیشتر از ۹۲ روز ماهانه، فقط ۱۲ ماه آخر', () => {
    const plan = planProfitTrend({ from: d(1403, 1, 15), to: d(1405, 7, 10) }, TODAY);
    expect(plan?.granularity).toBe('month');
    expect(plan?.buckets).toHaveLength(12);
    expect(plan?.buckets[0]).toEqual({ from: d(1404, 8, 1), to: d(1404, 8, 30), label: 'آبان ۰۴' });
    expect(plan?.buckets.at(-1)).toEqual({ from: d(1405, 7, 1), to: d(1405, 7, 10), label: 'مهر ۰۵' });
    // اسفند غیرکبیسه‌ی ۱۴۰۴ تا ۲۹ است.
    expect(plan?.buckets.find((bucket) => bucket.from.month === 12)?.to).toEqual(d(1404, 12, 29));
  });

  it('بدون بازه، شش ماه شمسی اخیر تا پایان ماه جاری', () => {
    expect(resolveTrendRange({ from: null, to: null }, TODAY)).toEqual({ from: d(1405, 2, 1), to: d(1405, 7, 30) });
    const plan = planProfitTrend({ from: null, to: null }, TODAY);
    expect(plan?.granularity).toBe('month');
    expect(plan?.buckets.map((bucket) => bucket.label)).toEqual([
      'اردیبهشت ۰۵',
      'خرداد ۰۵',
      'تیر ۰۵',
      'مرداد ۰۵',
      'شهریور ۰۵',
      'مهر ۰۵',
    ]);
    // فقط «تا»: شش ماه منتهی به آن.
    expect(resolveTrendRange({ from: null, to: d(1405, 3, 10) }, TODAY)).toEqual({
      from: d(1404, 10, 1),
      to: d(1405, 3, 10),
    });
    // فقط «از»: تا امروز.
    expect(resolveTrendRange({ from: d(1405, 7, 1), to: null }, TODAY)).toEqual({ from: d(1405, 7, 1), to: TODAY });
  });
});

describe('trendSeries', () => {
  function report(total: string, totalGold: string): LedgerProfitReport {
    const m = (rial: string, gold: string) => ({ rial, goldEquivalentMg: gold });
    return {
      from: null,
      to: null,
      revenue: m('0', '0'),
      costOfGoods: m('0', '0'),
      grossProfit: m('0', '0'),
      operatingProfit: m('100', '1'),
      coinBubbleEffect: m('20', '2'),
      goldPriceEffect: m('-5', '-3'),
      totalProfit: m(total, totalGold),
    };
  }

  it('فقط چهره‌ی سرور را در واحد فعال برمی‌دارد', () => {
    const buckets = [
      { from: d(1405, 7, 1), to: d(1405, 7, 3), label: 'الف' },
      { from: d(1405, 7, 4), to: d(1405, 7, 10), label: 'ب' },
    ];
    const reports = [report('115', '0'), report('-7', '9')];
    expect(trendSeries(buckets, reports, 'rial')).toEqual({
      labels: ['الف', 'ب'],
      operating: [100n, 100n],
      coinBubble: [20n, 20n],
      goldPrice: [-5n, -5n],
      total: [115n, -7n],
    });
    expect(trendSeries(buckets, reports, 'gold').total).toEqual([0n, 9n]);
  });
});
