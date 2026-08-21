import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gramRate1000 } from '@gold/core-calc';
import { useSaleDraftStore, type SaleDraftItemLine, type SaleLinePricingInput } from '@/stores/sale-draft-store';
import { useUnitStore } from '@/stores/unit-store';
import { calculateLinePricing } from './sale-line-pricing';
import { SaleSummary } from './SaleSummary';

/**
 * FE-044 — خلاصه‌ی فاکتور فروش (مرحله‌ی مرور).
 *
 * الگوی mock کردن `useMazneh` عیناً از `SaleLinePricingDialog.test.tsx`
 * (FE-043) وام گرفته شده. برخلاف آن فایل، اینجا `QueryClientProvider`
 * لازم نیست — `SaleSummary` هیچ hookای از `@/api/queries` صدا نمی‌زند.
 */

const useMaznehMock = vi.fn();
vi.mock('@/features/home/useMazneh', () => ({
  useMazneh: () => useMaznehMock(),
}));

const MAZNEH_RIAL_1 = 100_000_000n;
const MAZNEH_RIAL_2 = 250_000_000n;

function maznehSnapshot(maznehRial: bigint, overrides: Partial<{ source: 'MANUAL' | 'FEED'; observedAt: Date }> = {}) {
  return {
    data: {
      mazneh: maznehRial,
      gram750: gramRate1000(maznehRial), // مقدار دقیقش اینجا برای تست بی‌اهمیت است
      gram1000: gramRate1000(maznehRial),
      source: overrides.source ?? 'MANUAL',
      observedAt: overrides.observedAt ?? new Date('2026-08-10T09:00:00.000Z'),
      isStale: false,
    },
    isLoading: false,
    isError: false,
    isEmpty: false,
  };
}

const PARTY = { id: 'p1', displayName: 'حسین مرادی', mobile: '09121234567', type: 'CONSUMER' as const, status: 'ACTIVE' as const };

const PRICING_A: SaleLinePricingInput = {
  grossWeightMg: '10000',
  karat: 750,
  stoneWeightMg: '0',
  otherDeductionWeightMg: '0',
  wageType: 'FLAT',
  wageValue: '500000',
  profitRateBps: '0',
  taxRateBps: '0',
};

const PRICING_B: SaleLinePricingInput = {
  grossWeightMg: '5000',
  karat: 900,
  stoneWeightMg: '0',
  otherDeductionWeightMg: '0',
  wageType: 'FLAT',
  wageValue: '200000',
  profitRateBps: '0',
  taxRateBps: '0',
};

const LINE_A: SaleDraftItemLine = {
  lineId: 'l1',
  kind: 'CATALOG',
  jewelryItemId: 'j1',
  code: 'R-100',
  title: 'انگشتر سادگی',
  pricing: PRICING_A,
};

const LINE_B: SaleDraftItemLine = {
  lineId: 'l2',
  kind: 'ADHOC',
  jewelryItemId: null,
  code: '',
  title: 'طلای دست‌دوم مشتری',
  grossWeightMg: '5000',
  karat: 900,
  pricing: PRICING_B,
};

const UNPRICED_LINE: SaleDraftItemLine = {
  lineId: 'l3',
  kind: 'CATALOG',
  jewelryItemId: 'j3',
  code: 'B-200',
  title: 'دستبند بدون قیمت',
  pricing: null,
};

beforeEach(() => {
  useSaleDraftStore.getState().reset();
  sessionStorage.clear();
  localStorage.clear();
  useUnitStore.setState({ unit: 'gold' });
  useMaznehMock.mockReset();
  useMaznehMock.mockReturnValue(maznehSnapshot(MAZNEH_RIAL_1));
});

function dataRawUnderLabel(label: string, unit: 'gold' | 'rial'): string | null | undefined {
  const row = screen.getByText(label).closest('div');
  return row?.querySelector(`[data-unit="${unit}"]`)?.getAttribute('data-raw');
}

describe('SaleSummary — مشتری', () => {
  it('مشخصات مشتری انتخاب‌شده را نشان می‌دهد', () => {
    useSaleDraftStore.getState().setParty(PARTY);
    render(<SaleSummary />);

    expect(screen.getByText('حسین مرادی')).toBeInTheDocument();
    expect(screen.getByText('مصرف‌کننده')).toBeInTheDocument();
    expect(screen.getByText('09121234567')).toBeInTheDocument();
  });

  it('بدون مشتری، پیام مناسب نشان می‌دهد نه کرش', () => {
    render(<SaleSummary />);
    expect(screen.getByText('مشتری انتخاب نشده')).toBeInTheDocument();
  });
});

describe('SaleSummary — قفل نرخ', () => {
  it('اولین بار mount، مظنه‌ی زنده را در store قفل می‌کند و نمایش می‌دهد', () => {
    render(<SaleSummary />);

    expect(useSaleDraftStore.getState().lockedMazneh).toEqual({
      mazneh: MAZNEH_RIAL_1.toString(),
      source: 'MANUAL',
      observedAt: '2026-08-10T09:00:00.000Z',
    });
    expect(screen.getByText('مظنه‌ی ثبت‌شده برای این فاکتور')).toBeInTheDocument();
  });

  it('اگر از قبل قفل شده بود، mount دوباره آن را عوض نمی‌کند', () => {
    useSaleDraftStore.getState().lockMazneh({
      mazneh: MAZNEH_RIAL_1.toString(),
      source: 'MANUAL',
      observedAt: '2026-08-01T00:00:00.000Z',
    });
    useMaznehMock.mockReturnValue(maznehSnapshot(MAZNEH_RIAL_2)); // مظنه‌ی زنده عوض شده

    render(<SaleSummary />);

    expect(useSaleDraftStore.getState().lockedMazneh?.mazneh).toBe(MAZNEH_RIAL_1.toString());
  });

  it('وقتی مظنه‌ی بازار از نرخ قفل‌شده جلوتر می‌رود، فقط هشدار نشان می‌دهد — نرخ فاکتور عوض نمی‌شود', () => {
    useSaleDraftStore.getState().lockMazneh({
      mazneh: MAZNEH_RIAL_1.toString(),
      source: 'MANUAL',
      observedAt: '2026-08-01T00:00:00.000Z',
    });
    useMaznehMock.mockReturnValue(maznehSnapshot(MAZNEH_RIAL_2));

    render(<SaleSummary />);

    expect(screen.getByText(/نرخ بازار از زمان ورود به این مرحله تغییر کرده/)).toBeInTheDocument();
  });

  it('وقتی مظنه‌ی بازار همان نرخ قفل‌شده است، هشداری نشان نمی‌دهد', () => {
    useSaleDraftStore.getState().lockMazneh({
      mazneh: MAZNEH_RIAL_1.toString(),
      source: 'MANUAL',
      observedAt: '2026-08-01T00:00:00.000Z',
    });

    render(<SaleSummary />);

    expect(screen.queryByText(/نرخ بازار از زمان ورود به این مرحله تغییر کرده/)).not.toBeInTheDocument();
  });
});

describe('SaleSummary — اقلام و جمع کل', () => {
  it('ردیف بدون قیمت‌گذاری را با هشدار نشان می‌دهد', () => {
    useSaleDraftStore.getState().setItems([UNPRICED_LINE]);
    render(<SaleSummary />);

    expect(screen.getByText('قیمت‌گذاری نشده')).toBeInTheDocument();
  });

  it('جمع کل فقط از ردیف‌های قیمت‌گذاری‌شده حساب می‌شود و هشدار جزئی‌بودن را نشان می‌دهد', () => {
    useSaleDraftStore.getState().setItems([LINE_A, UNPRICED_LINE]);
    useUnitStore.setState({ unit: 'rial' });
    render(<SaleSummary />);

    expect(screen.getByText('برخی اقلام هنوز قیمت‌گذاری نشده‌اند — در جمع زیر لحاظ نشده‌اند.')).toBeInTheDocument();

    const expectedA = calculateLinePricing(PRICING_A, MAZNEH_RIAL_1);
    if (!expectedA.ok) throw new Error('fixture باید معتبر باشد');
    // ردیف بدون قیمت (UNPRICED_LINE) نباید در جمع لحاظ شود — جمع باید دقیقاً برابر تنها ردیف قیمت‌گذاری‌شده باشد
    expect(dataRawUnderLabel('مبلغ نهایی', 'rial')).toBe(expectedA.calc.payableRial.toString());
  });

  it('جمع کل مجموع دقیق دو ردیف قیمت‌گذاری‌شده را نشان می‌دهد (بدون هشدار جزئی‌بودن)', () => {
    useSaleDraftStore.getState().setItems([LINE_A, LINE_B]);
    useUnitStore.setState({ unit: 'rial' });
    render(<SaleSummary />);

    expect(
      screen.queryByText('برخی اقلام هنوز قیمت‌گذاری نشده‌اند — در جمع زیر لحاظ نشده‌اند.'),
    ).not.toBeInTheDocument();

    const calcA = calculateLinePricing(PRICING_A, MAZNEH_RIAL_1);
    const calcB = calculateLinePricing(PRICING_B, MAZNEH_RIAL_1);
    if (!calcA.ok || !calcB.ok) throw new Error('fixture باید معتبر باشد');
    const expectedTotal = calcA.calc.payableRial + calcB.calc.payableRial;

    expect(dataRawUnderLabel('مبلغ نهایی', 'rial')).toBe(expectedTotal.toString());
  });

  it('«معادل» همیشه هر دو واحد را با هم نشان می‌دهد، مستقل از کلید تعویض سراسری', () => {
    useSaleDraftStore.getState().setItems([LINE_A]);
    useUnitStore.setState({ unit: 'rial' }); // کلید سراسری روی ریال — «مبلغ نهایی» از آن پیروی می‌کند
    render(<SaleSummary />);

    expect(dataRawUnderLabel('معادل', 'gold')).not.toBeUndefined();
    expect(dataRawUnderLabel('معادل', 'rial')).not.toBeUndefined();
  });
});

describe('SaleSummary — روش پرداخت', () => {
  it('چون هنوز مرحله‌ی پرداخت ساخته نشده، جانگه‌دار مناسب نشان می‌دهد', () => {
    render(<SaleSummary />);
    expect(screen.getByText('هنوز انتخاب نشده — در مرحله‌ی «پرداخت» مشخص می‌شود.')).toBeInTheDocument();
  });
});
