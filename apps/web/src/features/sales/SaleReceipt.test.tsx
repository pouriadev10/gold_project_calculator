import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type * as ReactRouter from '@tanstack/react-router';
import type * as Queries from '@/api/queries';
import type * as SalesApi from '@/api/sales';
import type { SessionResponse } from '@/api/contracts';
import { useSessionStore } from '@/stores/session-store';
import { ApiError } from '@/api/api-error';
import { useUnitStore } from '@/stores/unit-store';
import { SaleReceipt } from './SaleReceipt';
import type { SaleSubmitOutcome } from './useJewelrySaleSubmit';

/**
 * FE-046 — رسید فروش.
 *
 * `useInvoiceVersions` mock می‌شود چون کل ادعای این تسک همین است: اعداد
 * رسید از پاسخ سرور می‌آیند. با mock کردن آن مرز می‌توان ثابت کرد رسید
 * وقتی پاسخ سرور با `outcome` محلی اختلاف دارد، **پاسخ سرور** را نشان
 * می‌دهد — چیزی که با داده‌ی واقعی قابل تفکیک نیست.
 */

const useInvoiceVersionsMock = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return {
    ...actual,
    Link: ({ to, params, children, ...rest }: { to: string; params?: Record<string, string>; children?: ReactNode }) => (
      <a href={to} data-params={JSON.stringify(params)} {...rest}>{children}</a>
    ),
  };
});

const getSalesInvoicePdfMock = vi.fn();
vi.mock('@/api/sales', async (importOriginal) => ({
  ...(await importOriginal<typeof SalesApi>()),
  getSalesInvoicePdf: (...args: unknown[]) => getSalesInvoicePdfMock(...args),
}));

vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useInvoiceVersions: (...args: unknown[]) => useInvoiceVersionsMock(...args),
}));

const PARTY_ID = 'a1000000-0000-4000-8000-000000000001';
const INVOICE_ID = 'd1000000-0000-4000-8000-000000000001';

const OUTCOME: SaleSubmitOutcome = {
  sale: {
    invoiceId: INVOICE_ID,
    invoiceNumber: 123,
    payableRial: 1_478_445_000n,
    ledgerTransactionId: 'e1000000-0000-4000-8000-000000000001',
    inventoryMovementId: 'f1000000-0000-4000-8000-000000000001',
  },
  party: {
    id: PARTY_ID,
    displayName: 'حسین مرادی',
    mobile: '09121234567',
    type: 'CONSUMER',
    status: 'ACTIVE',
  },
  lockedMazneh: {
    quoteId: 'c1000000-0000-4000-8000-000000000001',
    mazneh: '480000000',
    source: 'MANUAL',
    observedAt: '2026-08-22T09:00:00.000Z',
  },
  previewMismatchRial: undefined,
  mode: 'CASH',
  paidRial: 1_478_445_000n,
  receivableRial: 0n,
};

function versionHistory(overrides: Record<string, unknown> = {}) {
  return {
    invoiceId: INVOICE_ID,
    invoiceNumber: 123,
    versions: [
      {
        version: 1,
        reason: null,
        reasonDetail: null,
        partyId: PARTY_ID,
        actor: null,
        createdAt: '2026-08-22T10:30:00+00:00',
        payableRial: '1478445000',
        pureWeightMg: '7500',
        karat: 750,
        items: [
          { itemType: 'JEWELRY', itemId: 'b1000000-0000-4000-8000-000000000001', quantity: '1', pureWeightMg: '7500', karat: 750 },
        ],
        totalsSnapshot: {},
        settingsSnapshot: {},
        ledgerEffects: [],
        inventoryEffects: [],
      },
    ],
    ...overrides,
  };
}

function mockQuery(data: unknown, extra: Record<string, unknown> = {}) {
  useInvoiceVersionsMock.mockReturnValue({ data, isLoading: false, isError: false, error: null, ...extra });
}

beforeEach(() => {
  useInvoiceVersionsMock.mockReset();
  useUnitStore.setState({ unit: 'gold' });
});

describe('SaleReceipt — نمایش سند ثبت‌شده', () => {
  it('شماره، نسخه، زمان و مشتری را نشان می‌دهد', () => {
    mockQuery(versionHistory());
    render(<SaleReceipt outcome={OUTCOME} />);

    expect(screen.getByText('رسید فروش')).toBeInTheDocument();
    expect(screen.getByText('شماره فاکتور').parentElement).toHaveTextContent('۱۲۳');
    expect(screen.getByText('نسخه').parentElement).toHaveTextContent('۱');
    expect(screen.getByText('زمان ثبت')).toBeInTheDocument();
    expect(screen.getByText('حسین مرادی')).toBeInTheDocument();
  });

  it('رسید را با شناسه‌ی فاکتورِ پاسخ ثبت می‌خواند، نه چیز دیگری', () => {
    mockQuery(versionHistory());
    render(<SaleReceipt outcome={OUTCOME} />);

    expect(useInvoiceVersionsMock).toHaveBeenCalledWith(INVOICE_ID);
  });

  it('اقلام را از پاسخ سرور می‌سازد', () => {
    mockQuery(versionHistory());
    render(<SaleReceipt outcome={OUTCOME} />);

    expect(screen.getByText('اقلام (۱)')).toBeInTheDocument();
    expect(screen.getByText('زیورآلات')).toBeInTheDocument();
  });

  it('نسخه‌ی جاری را نشان می‌دهد، نه نسخه‌ی اول — و اصلاح‌شده بودن را برچسب می‌زند', () => {
    const history = versionHistory();
    const [first] = history.versions;
    mockQuery({
      ...history,
      // عمداً بی‌ترتیب: بیشترین `version` باید برنده شود، نه آخرین عضو آرایه
      versions: [{ ...first, version: 2, payableRial: '2000000000' }, first],
    });
    render(<SaleReceipt outcome={OUTCOME} />);

    expect(screen.getByText('نسخه').parentElement).toHaveTextContent('۲');
    expect(screen.getByText('اصلاح‌شده')).toBeInTheDocument();
  });

  it('نسخه‌ی ۱ برچسب «اصلاح‌شده» نمی‌گیرد', () => {
    mockQuery(versionHistory());
    render(<SaleReceipt outcome={OUTCOME} />);

    expect(screen.queryByText('اصلاح‌شده')).not.toBeInTheDocument();
  });
});

describe('SaleReceipt — پاسخ سرور جای محاسبه‌ی محلی را نمی‌گیرد', () => {
  it('مبلغ سرور را نشان می‌دهد، نه مبلغ پاسخِ ثبت', () => {
    // سرور عدد دیگری برمی‌گرداند؛ رسید باید همان را نشان دهد
    const history = versionHistory();
    const [first] = history.versions;
    mockQuery({ ...history, versions: [{ ...first, payableRial: '999999000' }] });
    // ریال، تا خود عدد سرور بی‌واسطه سنجیده شود، نه معادل طلایی‌اش
    useUnitStore.setState({ unit: 'rial' });
    render(<SaleReceipt outcome={OUTCOME} />);

    expect(screen.getByText('جمع فاکتور').parentElement).toHaveTextContent('۹۹۹٬۹۹۹٬۰۰۰');
  });

  it('اگر `partyId` پاسخ با مشتری محلی نخواند، نام نمایش داده نمی‌شود', () => {
    const history = versionHistory();
    const [first] = history.versions;
    mockQuery({ ...history, versions: [{ ...first, partyId: 'a1000000-0000-4000-8000-000000000099' }] });
    render(<SaleReceipt outcome={OUTCOME} />);

    expect(screen.queryByText('حسین مرادی')).not.toBeInTheDocument();
    expect(screen.getByText('a1000000-0000-4000-8000-000000000099')).toBeInTheDocument();
  });

  it('فروش نقدی مانده‌ی صفر و برچسب «تسویه» نشان می‌دهد', () => {
    mockQuery(versionHistory());
    render(<SaleReceipt outcome={OUTCOME} />);

    expect(screen.getByText('پرداخت‌شده (نقدی)')).toBeInTheDocument();
    expect(screen.getByText('مانده').parentElement).toHaveTextContent('تسویه');
    expect(screen.queryByText(/این فروش نسیه ثبت شد/)).not.toBeInTheDocument();
  });

  it('فروش نسیه مانده‌ی سرور را با برچسب «بدهکار» نشان می‌دهد', () => {
    mockQuery(versionHistory());
    useUnitStore.setState({ unit: 'rial' });
    render(
      <SaleReceipt
        outcome={{ ...OUTCOME, mode: 'CREDIT', paidRial: 478_445_000n, receivableRial: 1_000_000_000n }}
      />,
    );

    // مانده از پاسخ سرور می‌آید، نه از تفریق سمت کلاینت
    expect(screen.getByText('مانده').parentElement).toHaveTextContent('۱٬۰۰۰٬۰۰۰٬۰۰۰');
    expect(screen.getByText('مانده').parentElement).toHaveTextContent('بدهکار');
    expect(screen.getByText('پرداخت‌شده').parentElement).toHaveTextContent('۴۷۸٬۴۴۵٬۰۰۰');
  });

  it('روی فروش نسیه، بدهی مشتری صریح اعلام می‌شود', () => {
    mockQuery(versionHistory());
    render(<SaleReceipt outcome={{ ...OUTCOME, mode: 'CREDIT', paidRial: 0n, receivableRial: 1_478_445_000n }} />);

    expect(screen.getByText(/این فروش نسیه ثبت شد/)).toHaveTextContent('حسین مرادی');
  });

  it('اختلاف با پیش‌نمایش مرحله‌ی مرور را اعلام می‌کند', () => {
    mockQuery(versionHistory());
    render(<SaleReceipt outcome={{ ...OUTCOME, previewMismatchRial: 5_000n }} />);

    expect(screen.getByText(/مبلغ ثبت‌شده با پیش‌نمایش مرحله‌ی مرور یکی نیست/)).toBeInTheDocument();
  });

  it('مبلغ نیامده از سرور را با هشدار نشان می‌دهد، نه با صفر', () => {
    const history = versionHistory();
    const [first] = history.versions;
    mockQuery({ ...history, versions: [{ ...first, payableRial: null }] });
    render(<SaleReceipt outcome={OUTCOME} />);

    expect(screen.getByText(/مبلغ این نسخه در پاسخ سرور نیامده است/)).toBeInTheDocument();
    expect(screen.queryByText('جمع فاکتور')).not.toBeInTheDocument();
  });
});

describe('SaleReceipt — حالت‌های بارگذاری و خطا', () => {
  it('حین دریافت، پیام بارگذاری نشان می‌دهد', () => {
    useInvoiceVersionsMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null });
    render(<SaleReceipt outcome={OUTCOME} />);

    expect(screen.getByText(/در حال دریافت رسید/)).toBeInTheDocument();
  });

  it('خطای دریافت رسید را نشان می‌دهد — فروش ثبت شده، فقط رسیدش نیامده', () => {
    useInvoiceVersionsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(500, 'INTERNAL_ERROR', 'خطای داخلی'),
    });
    render(<SaleReceipt outcome={OUTCOME} />);

    expect(screen.getByText('خطا در انجام عملیات')).toBeInTheDocument();
  });

  it('پاسخ بدون هیچ نسخه‌ای، رسید خالی نمی‌سازد', () => {
    mockQuery({ invoiceId: INVOICE_ID, invoiceNumber: 123, versions: [] });
    render(<SaleReceipt outcome={OUTCOME} />);

    expect(screen.getByText(/هنوز نسخه‌ای برایش برنگشته است/)).toBeInTheDocument();
  });
});

describe('SaleReceipt — PDF و اشتراک رسید (FE-077/FE-079)', () => {
  const SESSION: SessionResponse = {
    accessToken: 'a',
    refreshToken: 'r',
    expiresInSeconds: 900,
    user: { id: 'u1', email: 'owner@example.com', displayName: 'مالک' },
    tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
    role: 'OWNER',
  };
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useSessionStore.setState({ session: SESSION });
    getSalesInvoicePdfMock.mockReset();
    getSalesInvoicePdfMock.mockResolvedValue({ content: new Blob(['%PDF-1.4']), fileName: 'invoice-123.pdf' });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:r'), revokeObjectURL: vi.fn() });
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useSessionStore.setState({ session: null });
    for (const key of ['share', 'canShare', 'clipboard']) Reflect.deleteProperty(navigator, key);
  });

  it('replaces the old disabled button with real PDF actions', () => {
    mockQuery(versionHistory());
    render(<SaleReceipt outcome={OUTCOME} />);
    expect(screen.queryByRole('button', { name: /به‌زودی/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'دریافت PDF' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'پیش‌نمایش' })).toBeEnabled();
  });

  it('desktop fallback: saves the PDF and copies the short text (no URL) when Web Share is missing', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mockQuery(versionHistory());
    render(<SaleReceipt outcome={OUTCOME} />);

    await userEvent.click(screen.getByRole('button', { name: 'اشتراک' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledOnce());
    expect(getSalesInvoicePdfMock).toHaveBeenCalledWith(INVOICE_ID, expect.any(AbortSignal));
    const text = writeText.mock.calls[0]![0];
    expect(text).toContain('رسید فروش زرگری نمونه');
    expect(text).toContain('فاکتور شماره ۱۲۳');
    expect(text).not.toMatch(/https?:|www\./u);
    expect(await screen.findByText('اشتراک در این مرورگر پشتیبانی نمی‌شود؛ PDF ذخیره شد و متن رسید کپی شد.')).toBeInTheDocument();
  });

  it('text-only Web Share: shares title + text right away, without fetching the PDF or any URL', async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    mockQuery(versionHistory());
    render(<SaleReceipt outcome={OUTCOME} />);

    await userEvent.click(screen.getByRole('button', { name: 'اشتراک' }));

    expect(share).toHaveBeenCalledOnce();
    const data = share.mock.calls[0]![0];
    expect(data.url).toBeUndefined();
    expect(data.files).toBeUndefined();
    expect(data.text).toContain('فاکتور شماره ۱۲۳');
    expect(getSalesInvoicePdfMock).not.toHaveBeenCalled();
  });

  it('file Web Share: sends the PDF together with the short text', async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn(() => true) });
    mockQuery(versionHistory());
    render(<SaleReceipt outcome={OUTCOME} />);

    await userEvent.click(screen.getByRole('button', { name: 'اشتراک' }));

    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    const data = share.mock.calls[0]![0];
    expect(data.files?.[0]?.name).toBe('invoice-123.pdf');
    expect(data.text).toContain('رسید فروش زرگری نمونه');
    expect(data.url).toBeUndefined();
  });
});

describe('SaleReceipt — شروع خرید مجدد B2C (FE-061)', () => {
  it('برای مشتری مصرف‌کننده، مسیر جداگانه‌ی خرید مجدد را با شناسه فاکتور درست نشان می‌دهد', () => {
    mockQuery(versionHistory());
    render(<SaleReceipt outcome={OUTCOME} />);

    const entry = screen.getByRole('link', { name: 'خرید مجدد از مشتری' });
    expect(entry).toHaveAttribute('href', '/sales/invoices/$invoiceId/b2c-buyback');
    expect(entry).toHaveAttribute('data-params', JSON.stringify({ invoiceId: INVOICE_ID }));
  });

  it('برای همکار، هیچ مسیر بازگشت یا خرید مجددی نمی‌سازد', () => {
    mockQuery(versionHistory());
    render(<SaleReceipt outcome={{ ...OUTCOME, party: { ...OUTCOME.party, type: 'BUSINESS' } }} />);

    expect(screen.queryByRole('link', { name: 'خرید مجدد از مشتری' })).not.toBeInTheDocument();
  });
});
