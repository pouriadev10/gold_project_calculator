import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { B2cBuybackPreview } from '@gold/contracts';
import type * as ReactRouter from '@tanstack/react-router';
import type * as Queries from '@/api/queries';
import type * as PurchaseApi from '@/api/purchase';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import type * as Mazneh from '@/features/home/useMazneh';
import type * as OnlineStatus from '@/hooks/useOnlineStatus';
import B2cBuybackStartPage from './B2cBuybackStartPage';

const useParamsMock = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return { ...actual, useParams: (...args: unknown[]) => useParamsMock(...args) };
});

const useInvoiceVersionsMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useInvoiceVersions: (...args: unknown[]) => useInvoiceVersionsMock(...args),
}));

const previewB2cBuybackMock = vi.fn();
vi.mock('@/api/purchase', async (importOriginal) => ({
  ...(await importOriginal<typeof PurchaseApi>()),
  previewB2cBuyback: (...args: unknown[]) => previewB2cBuybackMock(...args),
}));

const useMaznehMock = vi.fn();
vi.mock('@/features/home/useMazneh', async (importOriginal) => ({
  ...(await importOriginal<typeof Mazneh>()),
  useMazneh: () => useMaznehMock(),
}));

const useOnlineStatusMock = vi.fn();
vi.mock('@/hooks/useOnlineStatus', async (importOriginal) => ({
  ...(await importOriginal<typeof OnlineStatus>()),
  useOnlineStatus: () => useOnlineStatusMock(),
}));

const INVOICE_ID = 'd1000000-0000-4000-8000-000000000001';
const QUOTE_ID = 'c1000000-0000-4000-8000-000000000001';

const PREVIEW: B2cBuybackPreview = {
  sourceInvoiceId: INVOICE_ID,
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

beforeEach(() => {
  useParamsMock.mockReset();
  useInvoiceVersionsMock.mockReset();
  useMaznehMock.mockReset();
  useOnlineStatusMock.mockReset();
  previewB2cBuybackMock.mockReset();
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
  useParamsMock.mockReturnValue({ invoiceId: INVOICE_ID });
  useInvoiceVersionsMock.mockReturnValue({
    data: { invoiceId: INVOICE_ID, invoiceNumber: 123, versions: [] },
    isLoading: false,
    isError: false,
    error: null,
  });
  useMaznehMock.mockReturnValue({
    data: {
      quoteId: QUOTE_ID,
      mazneh: 1_000_000_000n,
      gram750: 230_000_000n,
      gram1000: 300_000_000n,
      source: 'MANUAL',
      observedAt: new Date('2026-09-10T08:00:00.000Z'),
      isStale: false,
    },
    isLoading: false,
    isError: false,
    isEmpty: false,
  });
  useOnlineStatusMock.mockReturnValue(true);
  previewB2cBuybackMock.mockResolvedValue(PREVIEW);
});

describe('B2cBuybackStartPage — مقایسه خرید مجدد B2C (FE-062)', () => {
  it('فاکتور را فقط مرجع می‌داند و تفاوت آن را با برگشت فروش روشن می‌کند', () => {
    render(<B2cBuybackStartPage />);

    expect(screen.getByRole('heading', { name: 'مقایسه خرید مجدد مشتری' })).toBeInTheDocument();
    expect(screen.getByText(/خرید طلای دست‌دوم از مشتری است/)).toBeInTheDocument();
    expect(screen.getByText(/فروش قبلی را برنمی‌گرداند/)).toBeInTheDocument();
    expect(screen.getByText('شماره فاکتور').parentElement).toHaveTextContent('۱۲۳');
    expect(screen.getByRole('note')).toHaveTextContent(/فقط مرجع خرید جدید است/);
  });

  it('شناسه فاکتور URL را برای خواندن مرجع به query می‌دهد', () => {
    render(<B2cBuybackStartPage />);

    expect(useInvoiceVersionsMock).toHaveBeenCalledWith(INVOICE_ID);
  });

  it('وزن امروز و مظنه‌ی جاری را برای پیش‌نمایش می‌گیرد، بدون دکمه‌ی ثبت خرید', () => {
    render(<B2cBuybackStartPage />);

    expect(screen.getByText('اندازه‌گیری امروز')).toBeInTheDocument();
    expect(screen.getByLabelText('وزن ناخالص')).toHaveAttribute('inputmode', 'none');
    expect(screen.getByText('مظنه‌ی امروز')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'نمایش مقایسه' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ثبت خرید/ })).not.toBeInTheDocument();
  });

  it('پیش‌نمایش را با وزن رشته‌ای و شناسه مظنه می‌گیرد و breakdown سرور را نشان می‌دهد', async () => {
    const user = userEvent.setup();
    render(<B2cBuybackStartPage />);

    await user.click(screen.getByLabelText('وزن ناخالص'));
    await user.click(screen.getByRole('button', { name: 'رقم ۱' }));
    await user.click(screen.getByRole('button', { name: 'نمایش مقایسه' }));

    expect(previewB2cBuybackMock).toHaveBeenCalledWith(
      INVOICE_ID,
      expect.objectContaining({
        grossWeightMg: '1000',
        stoneWeightMg: '0',
        otherDeductionWeightMg: '0',
        quoteId: QUOTE_ID,
        effectiveAt: expect.any(String),
      }),
    );
    expect(await screen.findByText('مقایسه‌ی خرید اولیه و خرید امروز')).toBeInTheDocument();
    expect(screen.getByText('اجرت سوخته')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ثبت خرید/ })).not.toBeInTheDocument();
  });
});
