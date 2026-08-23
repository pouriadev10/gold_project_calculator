import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toPersianDigits } from '@gold/core-calc';
import type * as Queries from '@/api/queries';
import type { CoinTypeVersion, InventoryBalance, Party, PriceQuote } from '@/api/contracts';
import CoinSaleForm from './CoinSaleForm';

/**
 * FE-048 — فرم فروش سکه.
 *
 * فقط مرز شبکه (`@/api/sales`) و query‌های خارجی mock می‌شوند؛
 * `useIdempotentSubmit` و خودِ محاسبات (`toCoinType`/`intrinsicValue`/
 * `bubble` واقعی از `core-calc`) دست‌نخورده می‌مانند — همان‌ها هستند که
 * «double tap یک فاکتور نسازد» و اعداد ارزش ذاتی/حباب را تضمین می‌کنند.
 */

const createCoinSaleMock = vi.fn();
vi.mock('@/api/sales', () => ({
  createCoinSale: (...args: unknown[]) => createCoinSaleMock(...args),
}));

const useCoinTypesMock = vi.fn();
const useInventoryBalancesMock = vi.fn();
const useLatestPriceQuoteMock = vi.fn();
const usePartiesMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useCoinTypes: () => useCoinTypesMock(),
  useInventoryBalances: (...args: unknown[]) => useInventoryBalancesMock(...args),
  useLatestPriceQuote: (...args: unknown[]) => useLatestPriceQuoteMock(...args),
  useParties: (...args: unknown[]) => usePartiesMock(...args),
}));

/**
 * `324885150` طوری انتخاب شده که `gramRate1000` واقعی دقیقاً `RATE_1000`
 * را بدون هیچ گرد کردنی بدهد — همان مقدار fixture در `CoinInventoryPage.test.tsx`.
 */
const QUOTE_ID = 'c1000000-0000-4000-8000-000000000001';

function priceQuote(): PriceQuote {
  return {
    id: QUOTE_ID,
    quoteType: 'MAZNEH',
    amountRial: 324_885_150n,
    source: 'MANUAL',
    observedAt: '2026-08-20T08:00:00+00:00',
    createdBy: null,
    createdAt: '2026-08-20T08:00:00+00:00',
  };
}

function party(): Party {
  return {
    id: 'a1000000-0000-4000-8000-000000000001',
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

const BAHAR: CoinTypeVersion = {
  id: 'v-bahar',
  coinTypeId: 'c-bahar',
  code: 'BAHAR',
  title: 'تمام بهار آزادی',
  grossWeightUg: '10000000', // 10g
  karat: 900,
  validFrom: '2026-07-30T09:00:00+00:00',
  validTo: null,
  version: 1,
  active: true,
  mintType: 'CENTRAL_BANK',
  isCentralBankMinted: true,
};

const PRIVATE: CoinTypeVersion = {
  id: 'v-private',
  coinTypeId: 'c-private',
  code: 'PRIVATE',
  title: 'سکه ضرب خصوصی',
  grossWeightUg: '3000000', // 3g
  karat: 900,
  validFrom: '2026-07-30T09:00:00+00:00',
  validTo: null,
  version: 1,
  active: true,
  mintType: 'PRIVATE_MINT',
  isCentralBankMinted: false,
};

function balance(itemId: string, quantity: string): InventoryBalance {
  return { itemType: 'COIN', itemId, quantity };
}

function renderForm() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <CoinSaleForm />
    </QueryClientProvider>,
  );
}

async function selectParty(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText('مشتری'));
  await user.type(screen.getByLabelText('جست‌وجوی نام یا موبایل'), 'حسین');
  await waitFor(() => expect(screen.getByText('حسین مرادی')).toBeInTheDocument());
  await user.click(screen.getByText('حسین مرادی'));
}

async function selectCoinType(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.selectOptions(screen.getByLabelText('نوع سکه'), title);
}

/** کیپد سفارشی با برچسب «رقم ۳» کار می‌کند، نه رقم لاتین — بخش ۶ CLAUDE.md */
async function typeDigits(user: ReturnType<typeof userEvent.setup>, digits: string) {
  for (const digit of digits) {
    await user.click(screen.getByRole('button', { name: `رقم ${toPersianDigits(digit)}` }));
  }
}

async function fillCoinAndPrice(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText('تعداد'));
  await typeDigits(user, '3');
  await user.click(screen.getByLabelText('قیمت واحد بازار'));
  await typeDigits(user, '1000000000');
}

/** پرداخت به‌صورت پیش‌فرض صفر است — این یک کپی یک‌باره‌ی «پرداخت کامل» را می‌زند */
async function payFull(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'پرداخت کامل' }));
}

beforeEach(() => {
  sessionStorage.clear();
  createCoinSaleMock.mockReset();
  useCoinTypesMock.mockReset();
  useInventoryBalancesMock.mockReset();
  useLatestPriceQuoteMock.mockReset();
  usePartiesMock.mockReset();

  useCoinTypesMock.mockReturnValue({ data: [BAHAR, PRIVATE], isLoading: false, isError: false, refetch: vi.fn() });
  useInventoryBalancesMock.mockReturnValue({
    data: [balance(BAHAR.coinTypeId, '5')],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  useLatestPriceQuoteMock.mockReturnValue({ data: priceQuote(), isLoading: false, isSuccess: true });
  usePartiesMock.mockReturnValue({ data: { items: [party()] }, isLoading: false, isError: false, refetch: vi.fn() });
});

describe('CoinSaleForm — فرم فروش سکه (FE-048)', () => {
  it('حباب فقط برای سکه‌ی بانک مرکزی رندر می‌شود، برای نوع خصوصی اصلاً نه', async () => {
    const user = userEvent.setup();
    renderForm();

    await selectCoinType(user, BAHAR.title);
    expect(screen.getByText('حباب نمایشی')).toBeInTheDocument();

    await selectCoinType(user, PRIVATE.title);
    expect(screen.queryByText('حباب نمایشی')).not.toBeInTheDocument();
  });

  it('موجودی جاری را به‌عنوان «تعداد قبل» به خلاصه‌ی موقعیت (FE-049) وصل می‌کند', async () => {
    const user = userEvent.setup();
    renderForm();

    await selectCoinType(user, BAHAR.title);
    expect(screen.getByText('تعداد قبل').nextElementSibling).toHaveTextContent('۵');
    expect(screen.getByText('تعداد بعد').nextElementSibling).toHaveTextContent('۵');

    await user.click(screen.getByLabelText('تعداد'));
    await typeDigits(user, '3');

    await waitFor(() => expect(screen.getByText('تعداد فروش').nextElementSibling).toHaveTextContent('۳'));
    expect(screen.getByText('تعداد بعد').nextElementSibling).toHaveTextContent('۲');
  });

  it('فروش یک نوع سکه را با payload درست ثبت می‌کند — تعداد number، نه رشته‌ی وزن', async () => {
    createCoinSaleMock.mockResolvedValue({
      invoiceId: 'd1000000-0000-4000-8000-000000000001',
      invoiceNumber: 501,
      payableRial: 3_000_000_000n,
      receivableRial: 0n,
      intrinsicValueRial: 900_000_000n,
      bubbleRial: 100_000_000n,
    });
    const user = userEvent.setup();
    renderForm();

    await selectParty(user);
    await selectCoinType(user, BAHAR.title);
    await fillCoinAndPrice(user);
    await payFull(user);

    await user.click(screen.getByRole('button', { name: 'ثبت فروش' }));

    await waitFor(() => expect(createCoinSaleMock).toHaveBeenCalledTimes(1));
    const [input] = createCoinSaleMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(input).toMatchObject({
      partyId: 'a1000000-0000-4000-8000-000000000001',
      coinTypeId: BAHAR.coinTypeId,
      count: 3,
      marketUnitPriceRial: '1000000000',
      quoteId: QUOTE_ID,
      paidRial: '3000000000',
    });
    expect(typeof input.count).toBe('number');

    await waitFor(() => expect(screen.getByText('فاکتور شماره ۵۰۱ ثبت شد')).toBeInTheDocument());
  });

  it('double tap فقط یک فراخوانی می‌سازد', async () => {
    let resolveSale: (value: unknown) => void = () => {};
    createCoinSaleMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSale = resolve;
      }),
    );
    const user = userEvent.setup();
    renderForm();

    await selectParty(user);
    await selectCoinType(user, BAHAR.title);
    await fillCoinAndPrice(user);

    const submitButton = screen.getByRole('button', { name: 'ثبت فروش' });
    await user.click(submitButton);
    await user.click(submitButton);

    expect(createCoinSaleMock).toHaveBeenCalledTimes(1);
    resolveSale({
      invoiceId: 'd1',
      invoiceNumber: 1,
      payableRial: 3_000_000_000n,
      receivableRial: 0n,
      intrinsicValueRial: 900_000_000n,
      bubbleRial: 100_000_000n,
    });
    await waitFor(() => expect(screen.getByText('فاکتور شماره ۱ ثبت شد')).toBeInTheDocument());
  });

  it('پرداخت بیشتر از مبلغ قابل‌پرداخت ثبت را مسدود می‌کند، نه سرور', async () => {
    const user = userEvent.setup();
    renderForm();

    await selectParty(user);
    await selectCoinType(user, BAHAR.title);
    await fillCoinAndPrice(user);
    await payFull(user);

    // «پرداخت کامل» مبلغ را برابر جمع کل کرد؛ یک رقم دیگر آن را بیشتر می‌کند
    await user.click(screen.getByLabelText('مبلغ پرداختی'));
    await typeDigits(user, '5');

    const submitButton = screen.getByRole('button', { name: 'ثبت فروش' });
    expect(submitButton).toBeDisabled();
    expect(screen.getByText('مبلغ پرداختی نمی‌تواند از مبلغ قابل‌پرداخت بیشتر باشد.')).toBeInTheDocument();
    expect(createCoinSaleMock).not.toHaveBeenCalled();
  });
});
