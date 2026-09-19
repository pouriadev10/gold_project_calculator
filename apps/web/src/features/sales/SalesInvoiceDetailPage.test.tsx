import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type * as ReactRouter from '@tanstack/react-router';
import type { SalesInvoiceDetail } from '@/api/contracts';
import { ApiError } from '@/api/api-error';
import { useUnitStore } from '@/stores/unit-store';
import SalesInvoiceDetailPage from './SalesInvoiceDetailPage';

const useSalesInvoiceDetailMock = vi.fn();
const getSalesInvoicePdfMock = vi.fn();

vi.mock('@/api/queries', () => ({
  useSalesInvoiceDetail: (...args: unknown[]) => useSalesInvoiceDetailMock(...args),
}));

vi.mock('@/api/sales', () => ({
  getSalesInvoicePdf: (...args: unknown[]) => getSalesInvoicePdfMock(...args),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return {
    ...actual,
    useParams: () => ({ invoiceId: 'd5000000-0000-4000-8000-000000000001' }),
    Link: ({
      to,
      params,
      children,
      ...rest
    }: {
      to: string;
      params?: Record<string, string>;
      children?: ReactNode;
    }) => (
      <a href={to} data-params={JSON.stringify(params)} {...rest}>
        {children}
      </a>
    ),
  };
});

const DETAIL: SalesInvoiceDetail = {
  id: 'd5000000-0000-4000-8000-000000000001',
  invoiceNumber: 122,
  status: 'FINALIZED',
  currentVersion: 2,
  party: {
    id: 'a1000000-0000-4000-8000-000000000001',
    displayName: 'حسین مرادی',
    type: 'CONSUMER',
    status: 'ACTIVE',
  },
  occurredAt: '2026-09-18T08:00:00.000Z',
  quoteSnapshot: {
    amountRial: '480000000',
    goldRatePerGramRial: '147744518',
    observedAt: '2026-09-18T07:59:00.000Z',
  },
  versions: [
    {
      version: 1,
      reason: null,
      reasonDetail: null,
      actor: {
        id: 'c1000000-0000-4000-8000-000000000001',
        displayName: 'صندوقدار فروشگاه',
      },
      createdAt: '2026-09-18T08:00:00.000Z',
      payableRial: '1900000000',
      paidRial: '1450000000',
      receivableRial: '450000000',
      pureWeightMg: '4250',
      items: [
        {
          itemType: 'JEWELRY',
          itemId: 'b1000000-0000-4000-8000-000000000001',
          title: 'دستبند ۱۸ عیار',
          quantity: '1',
          pureWeightMg: '4250',
          karat: 750,
          payableRial: '1900000000',
        },
      ],
      settingsSnapshot: {
        baseQuoteKarat: '705',
        mithqalGramsX10k: '46083',
        roundingUnitRial: '1000',
        roundingPolicy: 'ROUND_HALF_UP',
        profitRateBps: '700',
        taxRateBps: '1000',
      },
      ledgerSummary: { transactionCount: 1, entryCount: 5, balanced: true },
    },
    {
      version: 2,
      reason: 'WAGE_ERROR',
      reasonDetail: 'اصلاح اجرت ثبت‌شده',
      actor: {
        id: 'c1000000-0000-4000-8000-000000000002',
        displayName: 'مدیر فروشگاه',
      },
      createdAt: '2026-09-18T09:00:00.000Z',
      payableRial: '1950000000',
      paidRial: '1500000000',
      receivableRial: '450000000',
      pureWeightMg: '4250',
      items: [
        {
          itemType: 'JEWELRY',
          itemId: 'b1000000-0000-4000-8000-000000000001',
          title: 'دستبند ۱۸ عیار',
          quantity: '1',
          pureWeightMg: '4250',
          karat: 750,
          payableRial: '1950000000',
        },
      ],
      settingsSnapshot: {
        baseQuoteKarat: '705',
        mithqalGramsX10k: '46083',
        roundingUnitRial: '1000',
        roundingPolicy: 'ROUND_HALF_UP',
        profitRateBps: '700',
        taxRateBps: '1000',
      },
      ledgerSummary: { transactionCount: 1, entryCount: 5, balanced: true },
    },
  ],
};

function mockDetail(data: SalesInvoiceDetail = DETAIL): void {
  useSalesInvoiceDetailMock.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
}

beforeEach(() => {
  useSalesInvoiceDetailMock.mockReset();
  getSalesInvoicePdfMock.mockReset();
  useUnitStore.setState({ unit: 'gold' });
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:invoice'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SalesInvoiceDetailPage — snapshot و نسخه جاری', () => {
  it('شماره، وضعیت، مشتری و نسخه جاری را واضح نشان می‌دهد', () => {
    mockDetail();
    render(<SalesInvoiceDetailPage />);

    expect(useSalesInvoiceDetailMock).toHaveBeenCalledWith(DETAIL.id);
    expect(screen.getByText('شماره فاکتور').parentElement).toHaveTextContent('۱۲۲');
    expect(screen.getByText('نهایی')).toBeInTheDocument();
    expect(screen.getAllByText('نسخه جاری ۲')).toHaveLength(1);
    expect(screen.getByText('حسین مرادی')).toBeInTheDocument();
    expect(screen.getByText('اصلاح‌شده')).toBeInTheDocument();
  });

  it('مبلغ نسخه جاری را با نرخ قفل‌شده نمایش می‌دهد و UnitToggle آن را به ریال می‌برد', async () => {
    mockDetail();
    render(<SalesInvoiceDetailPage />);

    const totalRow = screen.getByText('جمع فاکتور').parentElement!;
    expect(totalRow.querySelector('[data-unit="gold"]')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'ریال' }));
    expect(totalRow.querySelector('[data-unit="rial"]')).toHaveAttribute('data-raw', '1950000000');
    expect(totalRow).toHaveTextContent('۱٬۹۵۰٬۰۰۰٬۰۰۰');
  });

  it('اقلام، پرداخت، مظنه، تنظیمات و خلاصه تراز دفترکل را از snapshot نشان می‌دهد', () => {
    mockDetail();
    render(<SalesInvoiceDetailPage />);

    expect(screen.getByText('دستبند ۱۸ عیار')).toBeInTheDocument();
    expect(screen.getByText('پرداخت‌شده')).toBeInTheDocument();
    expect(screen.getByText('مظنه قفل‌شده')).toBeInTheDocument();
    expect(screen.getByText('۴۸۰٬۰۰۰٬۰۰۰')).toBeInTheDocument();
    expect(screen.getByText('تنظیمات محاسبه همین نسخه')).toBeInTheDocument();
    expect(screen.getByText('نرخ سود').parentElement).toHaveTextContent('۷٫۰۰٪');
    expect(screen.getByText('خلاصه دفترکل')).toBeInTheDocument();
    expect(screen.getByText('تراز')).toBeInTheDocument();
  });

  it('تاریخچه را نزولی و نسخه جاری را از نسخه قبلی متمایز می‌کند', () => {
    mockDetail();
    render(<SalesInvoiceDetailPage />);

    const history = screen.getByText('تاریخچه نسخه‌ها').closest('div')?.parentElement;
    expect(history).not.toBeNull();
    expect(within(history!).getByText('اصلاح اجرت')).toBeInTheDocument();
    expect(within(history!).getByText('صدور اولیه')).toBeInTheDocument();
    expect(within(history!).getByText('جاری')).toBeInTheDocument();
    expect(within(history!).getByText('قبلی')).toBeInTheDocument();
  });
});

describe('SalesInvoiceDetailPage — اقدامات', () => {
  it('PDF را با endpoint احراز هویت‌شده دانلود می‌کند', async () => {
    mockDetail();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    getSalesInvoicePdfMock.mockResolvedValue({
      content: new Blob(['pdf'], { type: 'application/pdf' }),
      fileName: 'invoice-122.pdf',
    });
    render(<SalesInvoiceDetailPage />);

    await userEvent.click(screen.getByRole('button', { name: 'دریافت PDF' }));

    expect(getSalesInvoicePdfMock).toHaveBeenCalledWith(DETAIL.id);
    expect(click).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:invoice');
  });

  it('خرید مجدد را فقط برای مصرف‌کننده فعال می‌کند و اصلاح را تا policy سرور غیرفعال نگه می‌دارد', () => {
    mockDetail();
    render(<SalesInvoiceDetailPage />);

    const buyback = screen.getByRole('link', { name: 'خرید مجدد B2C' });
    expect(buyback).toHaveAttribute('href', '/sales/invoices/$invoiceId/b2c-buyback');
    expect(buyback).toHaveAttribute('data-params', JSON.stringify({ invoiceId: DETAIL.id }));
    expect(screen.getByRole('button', { name: 'اصلاح فاکتور' })).toBeDisabled();
    expect(screen.getByText(/policy سرور/)).toBeInTheDocument();
  });

  it('برای همکار، خرید مجدد B2C لینک نمی‌سازد', () => {
    mockDetail({ ...DETAIL, party: { ...DETAIL.party, type: 'BUSINESS' } });
    render(<SalesInvoiceDetailPage />);

    expect(screen.queryByRole('link', { name: 'خرید مجدد B2C' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'خرید مجدد B2C' })).toBeDisabled();
  });
});

describe('SalesInvoiceDetailPage — حالت‌های شبکه', () => {
  it('بارگذاری و خطای قابل تلاش مجدد را پوشش می‌دهد', async () => {
    const refetch = vi.fn();
    useSalesInvoiceDetailMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch,
    });
    const { container, rerender } = render(<SalesInvoiceDetailPage />);
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);

    useSalesInvoiceDetailMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(500, 'INTERNAL_ERROR', 'خطای داخلی'),
      refetch,
    });
    rerender(<SalesInvoiceDetailPage />);
    await userEvent.click(screen.getByRole('button', { name: 'تلاش دوباره' }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
