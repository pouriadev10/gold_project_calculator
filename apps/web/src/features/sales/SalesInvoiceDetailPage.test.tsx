import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type * as ReactRouter from '@tanstack/react-router';
import type { SalesInvoiceDetail } from '@/api/contracts';
import type { InvoiceAmendmentPreflight, SalesInvoiceAmendmentHistory, SalesInvoiceVersionHistory } from '@gold/contracts';
import { ApiError } from '@/api/api-error';
import { useUnitStore } from '@/stores/unit-store';
import SalesInvoiceDetailPage from './SalesInvoiceDetailPage';

const useSalesInvoiceDetailMock = vi.fn();
const useInvoiceAmendmentPolicyMock = vi.fn();
const useInvoiceVersionsMock = vi.fn();
const useInvoiceAmendmentsMock = vi.fn();
const getSalesInvoicePdfMock = vi.fn();

vi.mock('@/api/queries', () => ({
  useSalesInvoiceDetail: (...args: unknown[]) => useSalesInvoiceDetailMock(...args),
  useInvoiceAmendmentPolicy: (...args: unknown[]) => useInvoiceAmendmentPolicyMock(...args),
  useInvoiceVersions: (...args: unknown[]) => useInvoiceVersionsMock(...args),
  useInvoiceAmendments: (...args: unknown[]) => useInvoiceAmendmentsMock(...args),
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
  const history: SalesInvoiceVersionHistory = {
    invoiceId: data.id,
    invoiceNumber: data.invoiceNumber ?? 122,
    versions: data.versions.map((version) => ({
      version: version.version,
      reason: version.reason,
      reasonDetail: version.reasonDetail,
      partyId: data.party.id,
      actor: version.actor,
      createdAt: version.createdAt,
      payableRial: version.payableRial,
      pureWeightMg: version.pureWeightMg,
      karat: version.items[0]?.karat ?? null,
      items: version.items.map((item) => ({
        itemType: item.itemType,
        itemId: item.itemId,
        quantity: item.quantity,
        pureWeightMg: item.pureWeightMg,
        karat: item.karat,
      })),
      totalsSnapshot: { payableRial: version.payableRial },
      settingsSnapshot: version.settingsSnapshot,
      ledgerEffects: [],
      inventoryEffects: [],
    })),
  };
  useInvoiceVersionsMock.mockReturnValue({ data: history, isLoading: false, isError: false, refetch: vi.fn() });
  const amendments: SalesInvoiceAmendmentHistory = {
    invoiceId: data.id,
    invoiceNumber: data.invoiceNumber ?? 122,
    amendments: data.versions.flatMap((version, index) => {
      const before = data.versions[index - 1];
      if (!before || version.reason === null) return [];
      return [{
        version: version.version,
        reason: version.reason,
        reasonDetail: version.reasonDetail,
        actor: version.actor,
        createdAt: version.createdAt,
        changes: {
          payableRial: {
            before: before.payableRial,
            after: version.payableRial,
            delta: (BigInt(version.payableRial) - BigInt(before.payableRial)).toString(),
          },
          pureWeightMg: {
            before: before.pureWeightMg,
            after: version.pureWeightMg,
            delta: before.pureWeightMg === null || version.pureWeightMg === null
              ? null
              : (BigInt(version.pureWeightMg) - BigInt(before.pureWeightMg)).toString(),
          },
          karat: { before: before.items[0]?.karat ?? null, after: version.items[0]?.karat ?? null },
        },
        ledgerEffects: [],
        inventoryEffects: [],
      }];
    }),
  };
  useInvoiceAmendmentsMock.mockReturnValue({ data: amendments, isLoading: false, isError: false, refetch: vi.fn() });
}

function mockPolicy(
  overrides: Partial<InvoiceAmendmentPreflight> = {},
  state: { isFetching?: boolean; isError?: boolean } = {},
): void {
  useInvoiceAmendmentPolicyMock.mockReturnValue({
    data: {
      invoiceId: DETAIL.id,
      invoiceVersion: DETAIL.currentVersion,
      evaluatedAt: '2026-09-18T09:01:00.000Z',
      allowed: false,
      requiresManagerAuthorization: true,
      restrictions: ['OUTSIDE_CORRECTION_WINDOW'],
      ...overrides,
    } satisfies InvoiceAmendmentPreflight,
    isFetching: state.isFetching ?? false,
    isError: state.isError ?? false,
    refetch: vi.fn(),
  });
}

beforeEach(() => {
  useSalesInvoiceDetailMock.mockReset();
  useInvoiceAmendmentPolicyMock.mockReset();
  useInvoiceVersionsMock.mockReset();
  useInvoiceAmendmentsMock.mockReset();
  mockPolicy();
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

  it('اختلاف اصلاح را با نرخ قفل‌شده نشان می‌دهد و جزئیات نسخه قبلی فقط خواندنی است', async () => {
    mockDetail();
    render(<SalesInvoiceDetailPage />);

    expect(useInvoiceVersionsMock).toHaveBeenCalledWith(DETAIL.id);
    expect(useInvoiceAmendmentsMock).toHaveBeenCalledWith(DETAIL.id);
    const history = screen.getByText('تاریخچه نسخه‌ها').closest('div')?.parentElement;
    if (!history) throw new Error('تاریخچه نسخه‌ها پیدا نشد');
    const currentRow = within(history).getByText('نسخه ۲').closest('li')!;
    const previousRow = within(history).getByText('نسخه ۱').closest('li')!;
    expect(currentRow.compareDocumentPosition(previousRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const difference = within(currentRow).getByText('اختلاف مبلغ').parentElement!;
    expect(difference.querySelector('[data-unit="gold"]')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'ریال' }));
    expect(difference.querySelector('[data-unit="rial"]')).toHaveAttribute('data-raw', '50000000');

    await userEvent.click(within(previousRow).getByText('مشاهده جزئیات نسخه ۱'));
    expect(within(previousRow).getByText('مبلغ ثبت‌شده همین نسخه')).toBeVisible();
    expect(within(previousRow).getByText('اقلام این نسخه')).toBeVisible();
    expect(within(previousRow).getByText(/این نسخه و اثرهای حسابداری آن فقط خواندنی‌اند/)).toBeVisible();
    expect(within(history).queryByRole('button', { name: /حذف/ })).not.toBeInTheDocument();
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

  it('خرید مجدد را فقط برای مصرف‌کننده فعال می‌کند و دلیل منع اصلاح سرور را نشان می‌دهد', () => {
    mockDetail();
    render(<SalesInvoiceDetailPage />);

    const buyback = screen.getByRole('link', { name: 'خرید مجدد B2C' });
    expect(buyback).toHaveAttribute('href', '/sales/invoices/$invoiceId/b2c-buyback');
    expect(buyback).toHaveAttribute('data-params', JSON.stringify({ invoiceId: DETAIL.id }));
    expect(screen.getByRole('button', { name: 'اصلاح فاکتور' })).toBeDisabled();
    expect(useInvoiceAmendmentPolicyMock).toHaveBeenCalledWith(DETAIL.id);
    expect(screen.getByText('اصلاح به مجوز مدیر یا مالک نیاز دارد.')).toBeInTheDocument();
    expect(screen.getByText('مهلت اصلاح عادی این فاکتور گذشته است.')).toBeInTheDocument();
  });

  it('با تصمیم مجاز سرور مسیر فرم اصلاح را باز می‌کند', () => {
    mockDetail();
    mockPolicy({ allowed: true, requiresManagerAuthorization: false, restrictions: [] });
    render(<SalesInvoiceDetailPage />);

    const action = screen.getByRole('link', { name: 'اصلاح فاکتور' });
    expect(action).toHaveAttribute('href', '/sales/invoices/$invoiceId/amend');
    expect(action).toHaveAttribute('data-params', JSON.stringify({ invoiceId: DETAIL.id }));
    expect(screen.getByText('شروع اصلاح برای این حساب مجاز است.')).toBeInTheDocument();
    expect(
      screen.getByText(/هنگام ثبت، سرور دلیل و اختلاف مبلغ واقعی را دوباره بررسی می‌کند/),
    ).toBeInTheDocument();
  });

  it('برای نقش مدیر مجوز لازم را نشان می‌دهد ولی تصمیم مجاز سرور را مسدود نمی‌کند', () => {
    mockDetail();
    mockPolicy({ allowed: true, requiresManagerAuthorization: true });
    render(<SalesInvoiceDetailPage />);

    expect(screen.getByRole('link', { name: 'اصلاح فاکتور' })).toBeInTheDocument();
    expect(screen.getByText('اصلاح با مجوز مدیر برای این حساب مجاز است.')).toBeInTheDocument();
  });

  it('هنگام بارگذاری، خطا یا پاسخ نسخهٔ قدیمی اجازهٔ شروع نمی‌دهد', () => {
    mockDetail();
    mockPolicy({ allowed: true }, { isFetching: true });
    const { rerender } = render(<SalesInvoiceDetailPage />);
    expect(screen.getByRole('button', { name: 'اصلاح فاکتور' })).toBeDisabled();
    expect(screen.getByText('در حال بررسی مجوز اصلاح در سرور…')).toBeInTheDocument();

    mockPolicy({ allowed: true }, { isError: true });
    rerender(<SalesInvoiceDetailPage />);
    expect(screen.getByRole('button', { name: 'اصلاح فاکتور' })).toBeDisabled();
    expect(screen.getByText(/مجوز اصلاح دریافت نشد/)).toBeInTheDocument();

    mockPolicy({ allowed: true, invoiceVersion: DETAIL.currentVersion - 1 });
    rerender(<SalesInvoiceDetailPage />);
    expect(screen.getByRole('button', { name: 'اصلاح فاکتور' })).toBeDisabled();
    expect(screen.getByText(/پاسخ مجوز با نسخه جاری/)).toBeInTheDocument();
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
