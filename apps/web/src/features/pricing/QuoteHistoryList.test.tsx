import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PriceQuote } from '@/api/contracts';
import { QuoteHistoryList } from './QuoteHistoryList';

/**
 * FE-031 — تاریخچه‌ی مظنه.
 *
 * `usePriceQuoteHistory` مستقیم mock می‌شود (الگوی `useMazneh.test.tsx`
 * برای `useLatestPriceQuote`) — این تست فقط رفتار خودِ لیست را می‌سنجد:
 * حالت‌های بارگذاری/خطا/خالی، سوییچ جدول↔کارت بر اساس عرض، و pagination.
 */
const usePriceQuoteHistoryMock = vi.fn();
vi.mock('@/api/queries', () => ({
  usePriceQuoteHistory: (...args: unknown[]) => usePriceQuoteHistoryMock(...args),
}));

function quote(overrides: Partial<PriceQuote> = {}): PriceQuote {
  return {
    id: 'q1',
    quoteType: 'MAZNEH',
    amountRial: 480_000_000n,
    source: 'MANUAL',
    observedAt: new Date('2026-08-10T08:00:00Z').toISOString(),
    createdBy: 'u1',
    createdAt: new Date('2026-08-10T08:00:00Z').toISOString(),
    ...overrides,
  };
}

function manyQuotes(count: number): PriceQuote[] {
  return Array.from({ length: count }, (_, i) =>
    quote({
      id: `q${i}`,
      amountRial: BigInt(480_000_000 + i),
      observedAt: new Date(Date.UTC(2026, 7, 10, 8, 0, 0) - i * 60_000).toISOString(),
      source: i % 2 === 0 ? 'MANUAL' : 'FEED',
    }),
  );
}

function mockViewport(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('640px') && desktop,
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
  usePriceQuoteHistoryMock.mockReset();
  mockViewport(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('QuoteHistoryList — بارگذاری، خطا، خالی', () => {
  it('در حال بارگذاری: اسکلت نشان می‌دهد', () => {
    usePriceQuoteHistoryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    const { container } = render(<QuoteHistoryList />);
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });

  it('شکست دریافت: پیام خطا و دکمه‌ی تلاش دوباره', async () => {
    const refetch = vi.fn();
    usePriceQuoteHistoryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    const user = userEvent.setup();
    render(<QuoteHistoryList />);

    expect(screen.getByText('دریافت تاریخچه‌ی مظنه ناموفق بود.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'تلاش دوباره' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('فهرست خالی: پیام «تاریخچه‌ای وجود ندارد» را نشان می‌دهد', () => {
    usePriceQuoteHistoryMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<QuoteHistoryList />);
    expect(screen.getByText('تاریخچه‌ای وجود ندارد')).toBeInTheDocument();
  });
});

describe('QuoteHistoryList — نمای دسکتاپ (از ۶۴۰px به بالا)', () => {
  it('جدول با ستون‌های زمان/مبلغ/منبع رندر می‌شود', () => {
    mockViewport(true);
    usePriceQuoteHistoryMock.mockReturnValue({
      data: [quote({ id: 'q1', source: 'MANUAL' }), quote({ id: 'q2', source: 'FEED' })],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<QuoteHistoryList />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'زمان' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'مبلغ' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'منبع' })).toBeInTheDocument();
    expect(screen.getByText('دستی')).toBeInTheDocument();
    expect(screen.getByText('فید')).toBeInTheDocument();
  });
});

describe('QuoteHistoryList — نمای موبایل (زیر ۶۴۰px، تمام است وقتی: بدون جدول)', () => {
  it('به‌جای جدول، فهرست کارتی رندر می‌شود', () => {
    mockViewport(false);
    usePriceQuoteHistoryMock.mockReturnValue({
      data: [quote({ id: 'q1', source: 'MANUAL' })],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<QuoteHistoryList />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('دستی')).toBeInTheDocument();
  });
});

describe('QuoteHistoryList — pagination (سمت کلاینت، بدون صفحه‌بندی سرور)', () => {
  it('با ۱۰ ردیف یا کمتر، کنترل صفحه‌بندی نشان داده نمی‌شود', () => {
    usePriceQuoteHistoryMock.mockReturnValue({
      data: manyQuotes(10),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<QuoteHistoryList />);
    expect(screen.queryByRole('button', { name: /بعدی/ })).not.toBeInTheDocument();
  });

  it('با بیش از ۱۰ ردیف، «بعدی» صفحه‌ی دوم را نشان می‌دهد و «قبلی» فعال می‌شود', async () => {
    usePriceQuoteHistoryMock.mockReturnValue({
      data: manyQuotes(15),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    render(<QuoteHistoryList />);

    expect(screen.getByText('صفحه ۱ از ۲')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /قبلی/ })).toBeDisabled();
    // ردیف صفحه‌ی اول: id q0..q9 → amountRial 480000000..480000009؛ q10 هنوز دیده نمی‌شود
    expect(screen.getAllByRole('row')).toHaveLength(11); // ۱۰ ردیف داده + ۱ ردیف هدر

    await user.click(screen.getByRole('button', { name: /بعدی/ }));

    expect(screen.getByText('صفحه ۲ از ۲')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /بعدی/ })).toBeDisabled();
    expect(screen.getAllByRole('row')).toHaveLength(6); // ۵ ردیف باقی‌مانده + ۱ ردیف هدر
  });
});
