import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import type * as ReactRouter from '@tanstack/react-router';
import type * as Queries from '@/api/queries';
import type { Party, PriceQuote } from '@/api/contracts';
import { usePurchaseDraftStore } from '@/stores/purchase-draft-store';
import PurchaseWizardPage from './PurchaseWizardPage';

/**
 * FE-056 / FE-057 — صفحه‌ی خرید طلای دست‌دوم و مراحل وزن‌کشی.
 */

const useBlockerMock = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return {
    ...actual,
    Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
    useBlocker: (...args: unknown[]) => useBlockerMock(...args),
  };
});

const useLatestPriceQuoteMock = vi.fn();
const usePartiesMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useLatestPriceQuote: (...args: unknown[]) => useLatestPriceQuoteMock(...args),
  useParties: (...args: unknown[]) => usePartiesMock(...args),
}));

function priceQuote(): PriceQuote {
  return {
    id: 'q1',
    quoteType: 'MAZNEH',
    amountRial: 100_000_000n,
    source: 'MANUAL',
    observedAt: new Date().toISOString(),
    createdBy: null,
    createdAt: new Date().toISOString(),
  };
}

function party(overrides: Partial<Party>): Party {
  return {
    id: 'p1',
    type: 'CONSUMER',
    displayName: 'حسین مرادی',
    mobile: '09121234567',
    nationalId: null,
    linkedTenantId: null,
    status: 'ACTIVE',
    notes: null,
    createdAt: '2026-07-30T09:00:00+00:00',
    updatedAt: '2026-07-30T09:00:00+00:00',
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <PurchaseWizardPage />
    </QueryClientProvider>,
  );
}

/** گفت‌وجوی انتخاب فروشنده را باز می‌کند و شخصی را با جست‌وجو انتخاب می‌کند. */
async function selectSeller(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByLabelText('فروشنده'));
  await user.type(screen.getByLabelText('جست‌وجوی نام یا موبایل'), name.slice(0, 3));
  await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument());
  await user.click(screen.getByText(name));
}

beforeEach(() => {
  usePurchaseDraftStore.getState().reset();
  sessionStorage.clear();
  localStorage.clear();
  useBlockerMock.mockReset();
  useLatestPriceQuoteMock.mockReset();
  usePartiesMock.mockReset();

  useLatestPriceQuoteMock.mockReturnValue({ data: priceQuote(), isLoading: false, isSuccess: true });
  usePartiesMock.mockReturnValue({
    data: {
      items: [
        party({ id: 'p1', displayName: 'حسین مرادی', type: 'CONSUMER' }),
        party({ id: 'p2', displayName: 'شرکت طلای پارسیان', type: 'BUSINESS' }),
      ],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

describe('PurchaseWizardPage — شروع و پیمایش مراحل', () => {
  it('با مرحله‌ی «فروشنده» شروع می‌کند، نشانگر هشت‌مرحله‌ای و مقصد پیش‌فرض آبشده را نشان می‌دهد', () => {
    renderPage();
    expect(screen.getByText('مرحله ۱ از ۸ — فروشنده')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'مراحل خرید' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'قبلی' })).toBeDisabled();
    // قاعده‌ی تسک: مقصد پیش‌فرض آبشده نمایش داده شود
    expect(screen.getByText(/به موجودی آبشده اضافه می‌شود/)).toBeInTheDocument();
  });

  it('بدون انتخاب فروشنده، «بعدی» غیرفعال است', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'بعدی' })).toBeDisabled();
  });

  it('با انتخاب فروشنده‌ی مصرف‌کننده، «بعدی» فعال می‌شود و به وزن‌کشی می‌برد', async () => {
    const user = userEvent.setup();
    renderPage();

    await selectSeller(user, 'حسین مرادی');
    expect(screen.getByRole('button', { name: 'بعدی' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'بعدی' }));
    expect(screen.getByText('مرحله ۲ از ۸ — وزن‌کشی')).toBeInTheDocument();
  });

  it('انتخاب همکار (BUSINESS) «بعدی» را قفل و هشدار مصرف‌کننده را نشان می‌دهد', async () => {
    const user = userEvent.setup();
    renderPage();

    await selectSeller(user, 'شرکت طلای پارسیان');
    expect(screen.getByRole('alert')).toHaveTextContent(/فقط از شخص مصرف‌کننده/);
    expect(screen.getByRole('button', { name: 'بعدی' })).toBeDisabled();
  });

  it('بعد از انتخاب فروشنده، «قبلی» داده را از بین نمی‌برد', async () => {
    const user = userEvent.setup();
    renderPage();

    await selectSeller(user, 'حسین مرادی');
    await user.click(screen.getByRole('button', { name: 'بعدی' }));
    await user.click(screen.getByRole('button', { name: 'قبلی' }));

    expect(screen.getByText('مرحله ۱ از ۸ — فروشنده')).toBeInTheDocument();
    expect(screen.getByText('حسین مرادی')).toBeInTheDocument();
  });

  it('مراحل وزن‌کشی، کسورات و عیار فرم‌های واقعی رندر می‌کنند', async () => {
    const user = userEvent.setup();
    renderPage();

    await selectSeller(user, 'حسین مرادی');
    await user.click(screen.getByRole('button', { name: 'بعدی' }));
    expect(screen.getByText('مرحله ۲ از ۸ — وزن‌کشی')).toBeInTheDocument();
    expect(screen.getByLabelText('وزن کل (ناخالص)')).toBeInTheDocument();

    // ورود وزن ناخالص
    act(() => {
      usePurchaseDraftStore.getState().setGrossWeightMg('2500');
    });

    await user.click(screen.getByRole('button', { name: 'بعدی' }));
    expect(screen.getByText('مرحله ۳ از ۸ — کسورات')).toBeInTheDocument();
    expect(screen.getByLabelText('وزن نگین')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'بعدی' }));
    expect(screen.getByText('مرحله ۴ از ۸ — عیار')).toBeInTheDocument();
    expect(screen.getByLabelText('عیار خرید')).toBeInTheDocument();
  });
});

describe('PurchaseWizardPage — مرحله‌ی مظنه و مبلغ', () => {
  it('بدون مظنه، «بعدی» در مرحله مظنه غیرفعال است', () => {
    useLatestPriceQuoteMock.mockReturnValue({ data: null, isLoading: false, isSuccess: true });
    usePurchaseDraftStore.getState().setSeller({
      id: 'p1',
      displayName: 'حسین مرادی',
      mobile: '09121234567',
      type: 'CONSUMER',
      status: 'ACTIVE',
    });
    usePurchaseDraftStore.getState().setGrossWeightMg('2000');
    usePurchaseDraftStore.getState().goToStep('QUOTE');
    renderPage();

    expect(screen.getByText('مرحله ۵ از ۸ — مظنه')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'بعدی' })).toBeDisabled();
  });

  it('با مظنه‌ی موجود، «بعدی» فعال است و به مبلغ می‌برد و محاسبات را نشان می‌دهد', async () => {
    const user = userEvent.setup();
    usePurchaseDraftStore.getState().setSeller({
      id: 'p1',
      displayName: 'حسین مرادی',
      mobile: '09121234567',
      type: 'CONSUMER',
      status: 'ACTIVE',
    });
    usePurchaseDraftStore.getState().setGrossWeightMg('1000');
    usePurchaseDraftStore.getState().setStoneWeightMg('100');
    usePurchaseDraftStore.getState().setPurchaseKarat(740);
    usePurchaseDraftStore.getState().goToStep('QUOTE');
    renderPage();

    expect(screen.getByRole('button', { name: 'بعدی' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'بعدی' }));

    expect(screen.getByText('مرحله ۶ از ۸ — مبلغ')).toBeInTheDocument();
    expect(screen.getByLabelText('کارمزد خرید (اختیاری)')).toBeInTheDocument();
    expect(screen.getByText('مبلغ نهایی قابل پرداخت:')).toBeInTheDocument();
  });
});

describe('PurchaseWizardPage — مرحله‌ی آخر و هشدار خروج', () => {
  it('روی پرداخت، دکمه‌ی ثبت (هنوز بی‌کنش) جای «بعدی» می‌نشیند', () => {
    usePurchaseDraftStore.getState().goToStep('PAYMENT');
    renderPage();

    expect(screen.getByText('مرحله ۷ از ۸ — پرداخت')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ثبت خرید' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'بعدی' })).not.toBeInTheDocument();
    // رسید هرگز از مسیر «بعدی» در دسترس نیست
    expect(screen.queryByText('مرحله ۸ از ۸ — رسید')).not.toBeInTheDocument();
  });

  it('روی مرحله‌ی اول بدون هیچ انتخابی، شرط مسدودسازی خاموش است', () => {
    renderPage();
    expect(useBlockerMock).toHaveBeenLastCalledWith(expect.any(Function), false);
  });

  it('بعد از انتخاب فروشنده، شرط مسدودسازی روشن می‌شود', async () => {
    const user = userEvent.setup();
    renderPage();

    await selectSeller(user, 'حسین مرادی');
    expect(useBlockerMock).toHaveBeenLastCalledWith(expect.any(Function), true);
  });
});
