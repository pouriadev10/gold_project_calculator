import { describe, expect, it } from 'vitest';
import { ledgerProfitReportSchema, type LedgerProfitReport } from '@/api/contracts';
import { ledgerProfitReportFor } from '@/mocks/handlers/fixtures';
import { PROFIT_ROWS, isEmptyProfitReport, measureFace } from './profit-report';

/** FE-075 — توابع خالص گزارش سود. */

function zeroReport(): LedgerProfitReport {
  const zero = { rial: '0', goldEquivalentMg: '0' };
  return {
    from: null,
    to: null,
    revenue: zero,
    costOfGoods: zero,
    grossProfit: zero,
    operatingProfit: zero,
    goldPriceEffect: zero,
    coinBubbleEffect: zero,
    totalProfit: zero,
  };
}

describe('profit-report', () => {
  it('هر سنجه‌ی پاسخ سرور دقیقاً یک سطر دارد، به ترتیب breakdown', () => {
    expect(PROFIT_ROWS.map((row) => row.key)).toEqual([
      'revenue',
      'costOfGoods',
      'grossProfit',
      'coinBubbleEffect',
      'operatingProfit',
      'goldPriceEffect',
      'totalProfit',
    ]);
    const measureKeys = Object.keys(ledgerProfitReportSchema.shape).filter((key) => key !== 'from' && key !== 'to');
    expect([...PROFIT_ROWS.map((row) => row.key)].sort()).toEqual(measureKeys.sort());
  });

  it('چهره را فقط انتخاب می‌کند، بدون تبدیل', () => {
    const measure = { rial: '-1000', goldEquivalentMg: '7' };
    expect(measureFace(measure, 'rial')).toBe(-1000n);
    expect(measureFace(measure, 'gold')).toBe(7n);
  });

  it('گزارش تمام‌صفر را خالی می‌داند، ولی هر چهره‌ی غیرصفر را نه', () => {
    expect(isEmptyProfitReport(zeroReport())).toBe(true);
    expect(isEmptyProfitReport({ ...zeroReport(), goldPriceEffect: { rial: '0', goldEquivalentMg: '1' } })).toBe(false);
    expect(isEmptyProfitReport({ ...zeroReport(), revenue: { rial: '5', goldEquivalentMg: '0' } })).toBe(false);
  });
});

describe('mock MSW گزارش سود', () => {
  it('با قرارداد واقعی BE-060 سازگار است و روابط سرور را دارد', () => {
    const report = ledgerProfitReportFor('2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
    expect(ledgerProfitReportSchema.parse(report)).toEqual(report);
    for (const face of ['rial', 'goldEquivalentMg'] as const) {
      const v = (key: keyof typeof report) => BigInt((report[key] as { rial: string; goldEquivalentMg: string })[face]);
      expect(v('grossProfit')).toBe(v('revenue') - v('costOfGoods'));
      expect(v('operatingProfit')).toBe(v('grossProfit') - v('coinBubbleEffect'));
      expect(v('totalProfit')).toBe(v('grossProfit') + v('goldPriceEffect'));
    }
  });

  it('بازه‌ی آینده خالی است', () => {
    expect(isEmptyProfitReport(ledgerProfitReportFor('2099-01-01T00:00:00.000Z', null))).toBe(true);
  });
});
