import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type * as ReactRouter from '@tanstack/react-router';
import type * as Queries from '@/api/queries';
import type { Party, PriceQuote } from '@/api/contracts';
import { ApiError } from '@/api/api-error';
import {
  useSaleDraftStore,
  type LockedMazneh,
  type SaleDraftItemLine,
  type SaleLinePricingInput,
} from '@/stores/sale-draft-store';
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

/**
 * FE-045 — ثبت واقعی فروش. فقط مرز شبکه mock می‌شود (`api/sales`)؛
 * `useIdempotentSubmit`, `prepareJewelryCashSale` و خودِ store واقعی
 * می‌مانند، چون همان‌ها هستند که «double tap یک فاکتور بسازد» را تضمین
 * می‌کنند — mock کردنشان یعنی تست چیزی را نمی‌سنجد.
 */
const createJewelryCashSaleMock = vi.fn();
const createJewelryCreditSaleMock = vi.fn();
vi.mock('@/api/sales', () => ({
  createJewelryCashSale: (...args: unknown[]) => createJewelryCashSaleMock(...args),
  createJewelryCreditSale: (...args: unknown[]) => createJewelryCreditSaleMock(...args),
}));

const useLatestPriceQuoteMock = vi.fn();
const usePartiesMock = vi.fn();
const useJewelryItemsMock = vi.fn();
const useInventoryBalancesMock = vi.fn();
const useInvoiceVersionsMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useLatestPriceQuote: (...args: unknown[]) => useLatestPriceQuoteMock(...args),
  useParties: (...args: unknown[]) => usePartiesMock(...args),
  useJewelryItems: (...args: unknown[]) => useJewelryItemsMock(...args),
  useInventoryBalances: (...args: unknown[]) => useInventoryBalancesMock(...args),
  useInvoiceVersions: (...args: unknown[]) => useInvoiceVersionsMock(...args),
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

const QUOTE_ID = 'c1000000-0000-4000-8000-000000000001';
const JEWELRY_ITEM_ID = 'b1000000-0000-4000-8000-000000000001';

const LOCKED_MAZNEH: LockedMazneh = {
  quoteId: QUOTE_ID,
  mazneh: '480000000',
  source: 'MANUAL',
  observedAt: '2026-08-22T09:00:00.000Z',
};

const PRICING: SaleLinePricingInput = {
  grossWeightMg: '10000',
  karat: 750,
  stoneWeightMg: '0',
  otherDeductionWeightMg: '0',
  wageType: 'FLAT',
  wageValue: '5000000',
  profitRateBps: '700',
  taxRateBps: '1000',
};

function catalogLine(lineId = 'l1'): SaleDraftItemLine {
  return {
    lineId,
    kind: 'CATALOG',
    jewelryItemId: JEWELRY_ITEM_ID,
    code: 'RG-750-04',
    title: 'انگشتر ۱۸ عیار',
    pricing: PRICING,
  };
}

/** پیش‌نویسی که همه‌ی شرط‌های ثبت را دارد و روی مرحله‌ی «مرور» ایستاده. */
function seedReadyDraft(items: SaleDraftItemLine[] = [catalogLine()], paidRial: string | null = null) {
  const store = useSaleDraftStore.getState();
  store.setParty({
    id: 'a1000000-0000-4000-8000-000000000001',
    displayName: 'حسین مرادی',
    mobile: '09121234567',
    type: 'CONSUMER',
    status: 'ACTIVE',
  });
  store.setItems(items);
  store.lockMazneh(LOCKED_MAZNEH);
  store.setPaidRial(paidRial);
  store.goToStep('REVIEW');
}

/** پاسخ `GET /sales/invoices/:id/versions` — تنها منبع اعداد رسید (FE-046). */
const SERVER_VERSIONS = {
  invoiceId: 'd1000000-0000-4000-8000-000000000001',
  invoiceNumber: 123,
  versions: [
    {
      version: 1,
      reason: null,
      reasonDetail: null,
      partyId: 'a1000000-0000-4000-8000-000000000001',
      actor: null,
      createdAt: '2026-08-22T10:30:00+00:00',
      payableRial: '1478445000',
      pureWeightMg: '7500',
      karat: 750,
      items: [
        {
          itemType: 'JEWELRY' as const,
          itemId: JEWELRY_ITEM_ID,
          quantity: '1',
          pureWeightMg: '7500',
          karat: 750,
        },
      ],
      totalsSnapshot: {},
      settingsSnapshot: {},
      ledgerEffects: [],
      inventoryEffects: [],
    },
  ],
};

const SERVER_SALE = {
  invoiceId: 'd1000000-0000-4000-8000-000000000001',
  invoiceNumber: 123,
  payableRial: 1_478_445_000n,
  ledgerTransactionId: 'e1000000-0000-4000-8000-000000000001',
  inventoryMovementId: 'f1000000-0000-4000-8000-000000000001',
};

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
  createJewelryCashSaleMock.mockReset();
  createJewelryCreditSaleMock.mockReset();
  useInvoiceVersionsMock.mockReset();
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
  useInvoiceVersionsMock.mockReturnValue({
    data: SERVER_VERSIONS,
    isLoading: false,
    isError: false,
    error: null,
  });
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
  it('روی «مرور و ثبت»، به‌جای «بعدی» دکمه‌ی ثبت نشان می‌دهد', () => {
    seedReadyDraft();
    renderPage();

    expect(screen.getByRole('button', { name: 'ثبت فروش' })).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: 'بعدی' })).not.toBeInTheDocument();
  });

  it('با پیش‌نویس ناقص، دکمه‌ی ثبت غیرفعال است و دلیلش نوشته می‌شود', () => {
    useSaleDraftStore.getState().goToStep('REVIEW');
    renderPage();

    expect(screen.getByRole('button', { name: 'ثبت فروش' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('مشتری انتخاب نشده است.');
  });
});

describe('SaleWizardPage — ثبت فروش (FE-045)', () => {
  it('payload قرارداد را می‌فرستد و رسید سرور را نشان می‌دهد', async () => {
    createJewelryCashSaleMock.mockResolvedValue(SERVER_SALE);
    const user = userEvent.setup();
    seedReadyDraft();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'ثبت فروش' }));

    await waitFor(() => expect(screen.getByText('رسید فروش')).toBeInTheDocument());
    expect(createJewelryCashSaleMock).toHaveBeenCalledTimes(1);
    expect(createJewelryCashSaleMock.mock.calls[0]?.[0]).toEqual({
      partyId: 'a1000000-0000-4000-8000-000000000001',
      jewelryItemId: JEWELRY_ITEM_ID,
      quoteId: QUOTE_ID,
      effectiveAt: expect.any(String),
    });
    // کلید Idempotency اجباری است — بدون آن سرور فاکتور دوم می‌سازد
    expect(createJewelryCashSaleMock.mock.calls[0]?.[1]).toEqual(expect.any(String));
    expect(screen.getByText('شماره فاکتور').parentElement).toHaveTextContent('۱۲۳');
  });

  it('پس از موفقیت، پیش‌نویس پاک می‌شود ولی رسید سر جایش می‌ماند', async () => {
    createJewelryCashSaleMock.mockResolvedValue(SERVER_SALE);
    const user = userEvent.setup();
    seedReadyDraft();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'ثبت فروش' }));
    await waitFor(() => expect(screen.getByText('رسید فروش')).toBeInTheDocument());

    expect(useSaleDraftStore.getState().items).toHaveLength(0);
    expect(useSaleDraftStore.getState().party).toBeNull();
    expect(useSaleDraftStore.getState().lockedMazneh).toBeNull();
    expect(screen.getByRole('button', { name: 'فروش جدید' })).toBeInTheDocument();
  });

  it('«موفقیت» پیش از رسیدن پاسخ سرور نشان داده نمی‌شود', async () => {
    let release: (value: typeof SERVER_SALE) => void = () => {};
    createJewelryCashSaleMock.mockImplementation(
      () =>
        new Promise<typeof SERVER_SALE>((resolve) => {
          release = resolve;
        }),
    );
    const user = userEvent.setup();
    seedReadyDraft();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'ثبت فروش' }));

    expect(screen.queryByText('رسید فروش')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /در حال ثبت/ })).toBeDisabled();
    // تغییر فرم حین ارسال مسدود است
    expect(screen.getByRole('button', { name: 'قبلی' })).toBeDisabled();

    release(SERVER_SALE);
    await waitFor(() => expect(screen.getByText('رسید فروش')).toBeInTheDocument());
  });

  it('ضربه‌ی دوم حین ارسال، فاکتور دوم نمی‌سازد', async () => {
    let release: (value: typeof SERVER_SALE) => void = () => {};
    createJewelryCashSaleMock.mockImplementation(
      () =>
        new Promise<typeof SERVER_SALE>((resolve) => {
          release = resolve;
        }),
    );
    seedReadyDraft();
    renderPage();

    const submitButton = screen.getByRole('button', { name: 'ثبت فروش' });
    // `fireEvent` عمداً به‌جای `userEvent`: قفل واقعی روی ref سنکرون است،
    // نه روی `disabled`؛ با `userEvent` ضربه‌ی دوم اصلاً به دکمه نمی‌رسد و
    // چیزی سنجیده نمی‌شود.
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    expect(createJewelryCashSaleMock).toHaveBeenCalledTimes(1);

    release(SERVER_SALE);
    await waitFor(() => expect(screen.getByText('رسید فروش')).toBeInTheDocument());
  });

  it('خطای سرور پیش‌نویس را دست‌نخورده نگه می‌دارد و اجازه‌ی تلاش دوباره می‌دهد', async () => {
    createJewelryCashSaleMock.mockRejectedValueOnce(
      new ApiError(500, 'INTERNAL_ERROR', 'خطای داخلی'),
    );
    const user = userEvent.setup();
    seedReadyDraft();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'ثبت فروش' }));

    await waitFor(() => expect(screen.getByText('خطا در انجام عملیات')).toBeInTheDocument());
    expect(screen.queryByText('رسید فروش')).not.toBeInTheDocument();
    expect(useSaleDraftStore.getState().items).toHaveLength(1);
    expect(useSaleDraftStore.getState().party).not.toBeNull();
    expect(screen.getByRole('button', { name: 'ثبت فروش' })).not.toBeDisabled();
  });

  it('تلاش دوباره پس از خطا همان کلید Idempotency را می‌فرستد — نه یک فاکتور تازه', async () => {
    createJewelryCashSaleMock
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'خطای داخلی'))
      .mockResolvedValueOnce(SERVER_SALE);
    const user = userEvent.setup();
    seedReadyDraft();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'ثبت فروش' }));
    await waitFor(() => expect(screen.getByText('خطا در انجام عملیات')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'ثبت فروش' }));
    await waitFor(() => expect(screen.getByText('رسید فروش')).toBeInTheDocument());

    expect(createJewelryCashSaleMock).toHaveBeenCalledTimes(2);
    expect(createJewelryCashSaleMock.mock.calls[0]?.[1]).toBe(createJewelryCashSaleMock.mock.calls[1]?.[1]);
  });

  it('اختلاف مبلغ سرور با پیش‌نمایش کلاینت را نشان می‌دهد — عدد سرور برنده است', async () => {
    createJewelryCashSaleMock.mockResolvedValue({ ...SERVER_SALE, payableRial: 999_999_000n });
    const user = userEvent.setup();
    seedReadyDraft();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'ثبت فروش' }));

    await waitFor(() => expect(screen.getByText('رسید فروش')).toBeInTheDocument());
    expect(screen.getByText(/مبلغ ثبت‌شده با پیش‌نمایش مرحله‌ی مرور یکی نیست/)).toBeInTheDocument();
  });

  it('سبد چندقلمی ثبت نمی‌شود — به‌جای انداختن بی‌صدای قلم‌ها، دلیل را می‌گوید', () => {
    seedReadyDraft([catalogLine('l1'), catalogLine('l2')]);
    renderPage();

    expect(screen.getByRole('button', { name: 'ثبت فروش' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('فروش نقدی فعلاً فقط با یک قلم کالا ثبت می‌شود');
    expect(createJewelryCashSaleMock).not.toHaveBeenCalled();
  });

  it('پرداخت ناقص به endpoint نسیه می‌رود، نه نقدی', async () => {
    createJewelryCreditSaleMock.mockResolvedValue({ ...SERVER_SALE, receivableRial: 1_000_000_000n });
    const user = userEvent.setup();
    seedReadyDraft([catalogLine()], '478445000');
    renderPage();

    await user.click(screen.getByRole('button', { name: 'ثبت فروش' }));

    await waitFor(() => expect(screen.getByText('رسید فروش')).toBeInTheDocument());
    expect(createJewelryCashSaleMock).not.toHaveBeenCalled();
    expect(createJewelryCreditSaleMock).toHaveBeenCalledTimes(1);
    expect(createJewelryCreditSaleMock.mock.calls[0]?.[0]).toEqual({
      partyId: 'a1000000-0000-4000-8000-000000000001',
      jewelryItemId: JEWELRY_ITEM_ID,
      quoteId: QUOTE_ID,
      effectiveAt: expect.any(String),
      paidRial: '478445000',
    });
  });

  it('پرداخت کامل به endpoint نقدی می‌رود، نه نسیه', async () => {
    createJewelryCashSaleMock.mockResolvedValue(SERVER_SALE);
    const user = userEvent.setup();
    seedReadyDraft();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'ثبت فروش' }));

    await waitFor(() => expect(screen.getByText('رسید فروش')).toBeInTheDocument());
    expect(createJewelryCreditSaleMock).not.toHaveBeenCalled();
    expect(createJewelryCashSaleMock).toHaveBeenCalledTimes(1);
  });

  it('«پرداخت ناقص (نسیه)» فرم مبلغ را باز می‌کند و مسیر را عوض می‌کند', async () => {
    createJewelryCreditSaleMock.mockResolvedValue({ ...SERVER_SALE, receivableRial: 1_478_445_000n });
    const user = userEvent.setup();
    seedReadyDraft();
    renderPage();

    expect(screen.queryByLabelText('مبلغ دریافتی')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'پرداخت ناقص (نسیه)' }));
    expect(screen.getByLabelText('مبلغ دریافتی')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ثبت فروش' }));
    await waitFor(() => expect(createJewelryCreditSaleMock).toHaveBeenCalledTimes(1));
    // بدون تایپ هیچ رقمی، نسیه‌ی صفر ثبت می‌شود — نه «پرداخت کامل»
    expect(createJewelryCreditSaleMock.mock.calls[0]?.[0]).toMatchObject({ paidRial: '0' });
  });

  it('«فروش جدید» رسید را می‌بندد و به مرحله‌ی اول برمی‌گردد', async () => {
    createJewelryCashSaleMock.mockResolvedValue(SERVER_SALE);
    const user = userEvent.setup();
    seedReadyDraft();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'ثبت فروش' }));
    await waitFor(() => expect(screen.getByText('رسید فروش')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'فروش جدید' }));

    expect(screen.getByText('مرحله ۱ از ۵ — مظنه')).toBeInTheDocument();
    expect(screen.queryByText('رسید فروش')).not.toBeInTheDocument();
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
