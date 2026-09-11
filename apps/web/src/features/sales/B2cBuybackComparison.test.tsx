import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { B2cBuybackPreview } from '@gold/contracts';
import { useUnitStore } from '@/stores/unit-store';
import { B2cBuybackComparison } from './B2cBuybackComparison';

const PREVIEW: B2cBuybackPreview = {
  sourceInvoiceId: 'd1000000-0000-4000-8000-000000000001',
  original: {
    effectiveAt: '2026-07-18T09:20:00.000Z',
    quoteAmountRial: '630000000',
    quoteObservedAt: '2026-07-18T08:58:00.000Z',
    goldRatePerGramRial: '194000000',
    purchaseAmountRial: '825000000',
  },
  today: {
    effectiveAt: '2026-09-10T10:15:00.000Z',
    quoteAmountRial: '710000000',
    quoteObservedAt: '2026-09-10T10:00:00.000Z',
    goldRatePerGramRial: '218000000',
    purchaseAmountRial: '765000000',
  },
  breakdown: {
    originalPurchaseAmountRial: '825000000',
    todayPurchaseAmountRial: '765000000',
    differenceRial: '-60000000',
    wageBurnedRial: '45000000',
    karatDifferenceRial: '-12000000',
    marketPriceDifferenceRial: '9000000',
    otherCalculationDifferenceRial: '-12000000',
  },
};

function dataRawUnderLabel(label: string, unit: 'gold' | 'rial'): string | null | undefined {
  const row = screen.getByText(label).closest('div');
  return row?.querySelector(`[data-unit="${unit}"]`)?.getAttribute('data-raw');
}

beforeEach(() => useUnitStore.setState({ unit: 'rial' }));

describe('B2cBuybackComparison — breakdown معتبر backend (FE-062)', () => {
  it('دو رویداد را با نرخ و زمان جدا و تمام منشأهای اختلاف نشان می‌دهد', () => {
    render(<B2cBuybackComparison preview={PREVIEW} />);

    expect(screen.getByText('مقایسه‌ی خرید اولیه و خرید امروز')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'خرید اولیه' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'خرید امروز' })).toBeInTheDocument();
    expect(screen.getAllByText('تاریخ رویداد')).toHaveLength(2);
    expect(screen.getAllByText('زمان ثبت مظنه')).toHaveLength(2);
    expect(screen.getAllByText('مظنه‌ی قفل‌شده')).toHaveLength(2);
    expect(screen.getAllByText('نرخ هر گرم طلای ۱۰۰۰')).toHaveLength(2);
    expect(dataRawUnderLabel('مبلغ خرید اولیه', 'rial')).toBe('825000000');
    expect(dataRawUnderLabel('مبلغ پرداختی امروز', 'rial')).toBe('765000000');
    expect(dataRawUnderLabel('اجرت سوخته', 'rial')).toBe('-45000000');
    expect(dataRawUnderLabel('اختلاف عیار', 'rial')).toBe('-12000000');
    expect(dataRawUnderLabel('تغییر مظنه', 'rial')).toBe('9000000');
    expect(dataRawUnderLabel('سایر اختلافات محاسبه', 'rial')).toBe('-12000000');
    expect(dataRawUnderLabel('نتیجه نهایی', 'rial')).toBe('-60000000');
  });

  it('تفاوت کمتر یا بیشتر را خطا حساب نمی‌کند و کلید واحد روی تمام مبلغ‌ها اثر دارد', () => {
    useUnitStore.setState({ unit: 'gold' });
    render(<B2cBuybackComparison preview={PREVIEW} />);

    expect(screen.getByRole('note')).toHaveTextContent(
      /کمتر یا بیشتر از خرید اولیه باشد؛ این تفاوت طبیعی است/,
    );
    expect(dataRawUnderLabel('نتیجه نهایی', 'gold')).not.toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
