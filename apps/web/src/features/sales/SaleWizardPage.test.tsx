import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type * as ReactRouter from '@tanstack/react-router';
import type * as Queries from '@/api/queries';
import type { Party, PriceQuote } from '@/api/contracts';
import { useSaleDraftStore } from '@/stores/sale-draft-store';
import SaleWizardPage from './SaleWizardPage';

/**
 * FE-041 — صفحه‌ی شروع فروش (shell).
 *
 * `useBlocker` واقعی به `RouterProvider` نیاز دارد (همان دلیل mock کردن
 * `Link` در `PartyList.test.tsx`) — اینجا هم mock می‌شود تا فقط بررسی
 * شود این کامپوننت با ورودی درست (`condition` بر اساس `hasSaleDraftProgress`)
 * صدایش می‌زند، نه اینکه خودِ مکانیزم مسدودسازی مسیر (مسئولیت خودِ
 * کتابخانه) دوباره آزموده شود.
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
const useJewelryItemsMock = vi.fn();
const useInventoryBalancesMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useLatestPriceQuote: (...args: unknown[]) => useLatestPriceQuoteMock(...args),
  useParties: (...args: unknown[]) => usePartiesMock(...args),
  useJewelryItems: (...args: unknown[]) => useJewelryItemsMock(...args),
  useInventoryBalances: (...args: unknown[]) => useInventoryBalancesMock(...args),
}));

function priceQuote(): PriceQuote {
  return {
    id: 'q1',
    quoteType: 'MAZNEH',
    amountRial: 324_885_150n,
    source: 'MANUAL',
    observedAt: new Date().toISOString(),
    createdBy: null,
    createdAt: new Date().toISOString(),
  };
}

function party(): Party {
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
  };
}

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <SaleWizardPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useSaleDraftStore.getState().reset();
  sessionStorage.clear();
  useBlockerMock.mockReset();
  useLatestPriceQuoteMock.mockReset();
  usePartiesMock.mockReset();
  useJewelryItemsMock.mockReset();
  useInventoryBalancesMock.mockReset();

  useLatestPriceQuoteMock.mockReturnValue({ data: priceQuote(), isLoading: false, isSuccess: true });
  usePartiesMock.mockReturnValue({ data: { items: [party()] }, isLoading: false, isError: false, refetch: vi.fn() });
  useJewelryItemsMock.mockReturnValue({
    data: { items: [], total: 0, limit: 20, offset: 0 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  useInventoryBalancesMock.mockReturnValue({ data: [], isLoading: false, isError: false });
});

/** به مرحله‌ی «اقلام» می‌رسد: بعدی (مظنه) → انتخاب مشتری → بعدی (مشتری). */
async function goToItemsStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'بعدی' })); // مشتری
  await user.click(screen.getByLabelText('مشتری'));
  await user.type(screen.getByLabelText('جست‌وجوی نام یا موبایل'), 'حسین');
  await waitFor(() => expect(screen.getByText('حسین مرادی')).toBeInTheDocument());
  await user.click(screen.getByText('حسین مرادی'));
  await user.click(screen.getByRole('button', { name: 'بعدی' })); // اقلام
}

describe('SaleWizardPage — شروع و پیشرفت مراحل', () => {
  it('با مرحله‌ی «مظنه» شروع می‌شود و نشانگر پیشرفت آن را نشان می‌دهد', () => {
    renderPage();
    expect(screen.getByText('مرحله ۱ از ۵ — مظنه')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'قبلی' })).toBeDisabled();
  });

  it('با مظنه‌ی موجود، «بعدی» فعال است و به مرحله‌ی مشتری می‌برد', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'بعدی' }));
    expect(screen.getByText('مرحله ۲ از ۵ — مشتری')).toBeInTheDocument();
    expect(screen.getByLabelText('مشتری')).toBeInTheDocument();
  });

  it('بدون مظنه، «بعدی» غیرفعال است', () => {
    useLatestPriceQuoteMock.mockReturnValue({ data: null, isLoading: false, isSuccess: true });
    renderPage();
    expect(screen.getByRole('button', { name: 'بعدی' })).toBeDisabled();
  });
});

describe('SaleWizardPage — مرحله‌ی مشتری', () => {
  it('بدون انتخاب مشتری، «بعدی» غیرفعال است', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'بعدی' })); // به مرحله‌ی مشتری

    expect(screen.getByRole('button', { name: 'بعدی' })).toBeDisabled();
  });

  it('انتخاب مشتری «بعدی» را فعال می‌کند و به مرحله‌ی اقلام می‌رود', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'بعدی' })); // مشتری

    await user.click(screen.getByLabelText('مشتری'));
    await user.type(screen.getByLabelText('جست‌وجوی نام یا موبایل'), 'حسین');
    await waitFor(() => expect(screen.getByText('حسین مرادی')).toBeInTheDocument());
    await user.click(screen.getByText('حسین مرادی'));
    expect(screen.getByRole('button', { name: 'بعدی' })).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'بعدی' })); // اقلام
    expect(screen.getByText('مرحله ۳ از ۵ — اقلام')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'افزودن کالا' })).toBeInTheDocument();
  });
});

describe('SaleWizardPage — مرحله‌ی اقلام', () => {
  it('بدون هیچ قلمی، «بعدی» غیرفعال است', async () => {
    const user = userEvent.setup();
    renderPage();
    await goToItemsStep(user);

    expect(screen.getByRole('button', { name: 'بعدی' })).toBeDisabled();
  });

  it('افزودن یک کالا از نتایج جست‌وجو «بعدی» را فعال می‌کند', async () => {
    useJewelryItemsMock.mockReturnValue({
      data: {
        items: [
          {
            id: 'v1',
            jewelryItemId: 'j1',
            code: 'R-100',
            title: 'انگشتر سادگی',
            grossWeightMg: '5000',
            karat: 750,
            stoneWeightMg: '0',
            otherDeductionWeightMg: '0',
            wageType: 'PER_GRAM',
            wageValue: '0',
            validFrom: '2026-01-01T00:00:00+00:00',
            validTo: null,
            version: 1,
            active: true,
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    renderPage();
    await goToItemsStep(user);

    expect(screen.getByRole('button', { name: 'بعدی' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'افزودن کالا' }));
    await user.type(screen.getByLabelText('جست‌وجوی کد یا عنوان'), 'انگشتر');
    await user.click(await screen.findByRole('option', { name: /انگشتر سادگی/ }));

    // گفت‌وگو چندانتخابی است و بعد از افزودن باز می‌ماند (FE-042) — بقیه‌ی
    // صفحه تا وقتی باز است aria-hidden می‌ماند؛ کاربر واقعی هم پیش از
    // زدن «بعدی» باید گفت‌وگو را ببندد.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'بعدی' })).not.toBeDisabled();
  });
});

describe('SaleWizardPage — رفت‌وبرگشت مراحل داده را از بین نمی‌برد', () => {
  it('انتخاب مشتری، رفتن به اقلام و برگشت به مشتری، انتخاب را نگه می‌دارد', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'بعدی' })); // مشتری
    await user.click(screen.getByLabelText('مشتری'));
    await user.type(screen.getByLabelText('جست‌وجوی نام یا موبایل'), 'حسین');
    await waitFor(() => expect(screen.getByText('حسین مرادی')).toBeInTheDocument());
    await user.click(screen.getByText('حسین مرادی'));
    await user.click(screen.getByRole('button', { name: 'بعدی' })); // اقلام
    await user.click(screen.getByRole('button', { name: 'قبلی' })); // برگشت به مشتری

    expect(screen.getByText('مرحله ۲ از ۵ — مشتری')).toBeInTheDocument();
    expect(screen.getByLabelText('مشتری')).toHaveTextContent('حسین مرادی');
  });
});

describe('SaleWizardPage — آخرین مرحله', () => {
  it('روی «مرور و ثبت»، به‌جای «بعدی» دکمه‌ی ثبت غیرفعال نشان می‌دهد', () => {
    useSaleDraftStore.getState().goToStep('REVIEW');
    renderPage();

    expect(screen.getByRole('button', { name: /ثبت فروش/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'بعدی' })).not.toBeInTheDocument();
  });
});

describe('SaleWizardPage — هشدار خروج مسیر', () => {
  it('روی مرحله‌ی اول بدون هیچ انتخابی، شرط مسدودسازی خاموش است', () => {
    renderPage();
    expect(useBlockerMock).toHaveBeenLastCalledWith(expect.any(Function), false);
  });

  it('بعد از انتخاب مشتری، شرط مسدودسازی روشن می‌شود', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'بعدی' }));
    await user.click(screen.getByLabelText('مشتری'));
    await user.type(screen.getByLabelText('جست‌وجوی نام یا موبایل'), 'حسین');
    await waitFor(() => expect(screen.getByText('حسین مرادی')).toBeInTheDocument());
    await user.click(screen.getByText('حسین مرادی'));

    expect(useBlockerMock).toHaveBeenLastCalledWith(expect.any(Function), true);
  });
});
