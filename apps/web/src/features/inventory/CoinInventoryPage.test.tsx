import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dualFromRial, formatCoinCount, formatGram, formatRial, toPersianDigits } from '@gold/core-calc';
import type * as Queries from '@/api/queries';
import type { CoinTypeVersion, InventoryBalance, PriceQuote } from '@/api/contracts';
import CoinInventoryPage from './CoinInventoryPage';

/**
 * FE-038 — موجودی سکه.
 *
 * سه query مستقل mock می‌شود: `useCoinTypes` (کاتالوگ، بدون معادل بک‌اندی
 * هنوز)، `useInventoryBalances` (مانده‌ی واقعی BE-028) و `useLatestPriceQuote`
 * (که `useMazneh` روی آن سوار است — مستقیم mock کردنِ خودِ `useMazneh` غیرممکن
 * است چون این فایل export نشده جز از طریق hook، پس لایه‌ی زیرینش mock می‌شود).
 *
 * اعداد fixture عمداً گرد انتخاب شده‌اند (وزن ۱۰ و ۵ گرم، نرخ ۱۰۰ میلیون)
 * تا انتظارها بدون گرد کردن میانی قابل محاسبه‌ی دستی بمانند.
 */

const useCoinTypesMock = vi.fn();
const useInventoryBalancesMock = vi.fn();
const useLatestPriceQuoteMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useCoinTypes: () => useCoinTypesMock(),
  useInventoryBalances: (...args: unknown[]) => useInventoryBalancesMock(...args),
  useLatestPriceQuote: (...args: unknown[]) => useLatestPriceQuoteMock(...args),
}));

const RATE_1000 = 100_000_000n;

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

const NIM: CoinTypeVersion = {
  id: 'v-nim',
  coinTypeId: 'c-nim',
  code: 'NIM',
  title: 'نیم سکه',
  grossWeightUg: '5000000', // 5g
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

/**
 * `324885150` طوری انتخاب شده که `gramRate1000` واقعی (`packages/core-calc/src/pricing.ts`،
 * مظنه × ۱۰۰۰ ÷ ۳۲۴۸٫۸۵۱۵) دقیقاً `RATE_1000` را بدون هیچ گرد کردنی بدهد —
 * ۳۲۴٬۸۸۵٬۱۵۰ ÷ ۳٫۲۴۸۸۵۱۵ = ۱۰۰٬۰۰۰٬۰۰۰ عیناً.
 */
function priceQuote(): PriceQuote {
  return {
    id: 'q1',
    quoteType: 'MAZNEH',
    amountRial: 324_885_150n,
    source: 'MANUAL',
    observedAt: '2026-08-20T08:00:00+00:00',
    createdBy: null,
    createdAt: '2026-08-20T08:00:00+00:00',
  };
}

function balance(itemId: string, quantity: string): InventoryBalance {
  return { itemType: 'COIN', itemId, quantity };
}

function mockDesktopViewport() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('640px'),
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

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <CoinInventoryPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockDesktopViewport();
  useCoinTypesMock.mockReset();
  useInventoryBalancesMock.mockReset();
  useLatestPriceQuoteMock.mockReset();

  useCoinTypesMock.mockReturnValue({
    data: [BAHAR, NIM, PRIVATE],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  useInventoryBalancesMock.mockReturnValue({
    data: [balance(BAHAR.coinTypeId, '3'), balance(NIM.coinTypeId, '-1')],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  useLatestPriceQuoteMock.mockReturnValue({
    data: priceQuote(),
    isLoading: false,
    isSuccess: true,
  });
});

describe('CoinInventoryPage — هر نوع سکه مستقل', () => {
  it('هر سه نوع را با تعداد درست خودشان نشان می‌دهد — مثبت، منفی و غایب از پاسخ balances', () => {
    renderPage();

    expect(screen.getByText('تمام بهار آزادی')).toBeInTheDocument();
    expect(screen.getByText('نیم سکه')).toBeInTheDocument();
    expect(screen.getByText('سکه ضرب خصوصی')).toBeInTheDocument();

    // ستون «تعداد» دومین سلول هر ردیف است — عمداً کل ردیف را چک نمی‌کنیم چون
    // اعداد دیگر ردیف (ارزش ذاتی) می‌توانند به‌طور تصادفی همان رقم را داشته
    // باشند و false-positive بسازند، مخصوصاً برای «۰».
    const rows = screen.getAllByRole('row').slice(1); // ردیف اول هدر است
    const countCell = (row: HTMLElement) => within(row).getAllByRole('cell')[1];
    expect(countCell(rows[0]!)).toHaveTextContent(formatCoinCount(3));
    expect(countCell(rows[1]!)).toHaveTextContent(formatCoinCount(-1));
    // «سکه ضرب خصوصی» هیچ ردیفی در balances ندارد — باید صفر واضح نمایش داده شود، نه خالی
    expect(countCell(rows[2]!)).toHaveTextContent(formatCoinCount(0));
  });

  it('ارزش ذاتی هر نوع را با فرمول واقعی core-calc محاسبه و نمایش می‌دهد', () => {
    renderPage();

    // BAHAR: ۱۰ گرم × عیار ۹۰۰ = ۹ گرم خالص × نرخ ۱۰۰٬۰۰۰٬۰۰۰ = ۹۰۰٬۰۰۰٬۰۰۰ ریال
    const baharIntrinsic = dualFromRial(900_000_000n, RATE_1000);
    expect(screen.getByText(formatGram(baharIntrinsic.pureMg))).toBeInTheDocument();

    // NIM: ۵ گرم × ۹۰۰ = ۴٫۵ گرم خالص × نرخ = ۴۵۰٬۰۰۰٬۰۰۰ ریال
    const nimIntrinsic = dualFromRial(450_000_000n, RATE_1000);
    expect(screen.getByText(formatGram(nimIntrinsic.pureMg))).toBeInTheDocument();
  });
});

describe('CoinInventoryPage — قانون حباب', () => {
  it('پیش از واردکردن قیمت بازار، حباب محاسبه نمی‌شود', () => {
    renderPage();
    expect(screen.getAllByText('قیمت بازار را وارد کنید')).toHaveLength(2); // فقط دو نوع بانک مرکزی
  });

  it('برای نوع غیربانکی، نه ورودی قیمت بازار نشان داده می‌شود و نه حباب — حتی به‌صورت غیرفعال', () => {
    renderPage();
    const rows = screen.getAllByRole('row').slice(1);
    const privateRow = rows[2] as HTMLElement;
    expect(privateRow).toHaveTextContent('بی‌ربط — این نوع حباب ندارد');
    expect(within(privateRow).queryByLabelText('قیمت بازار')).not.toBeInTheDocument();
  });

  it('با واردکردن قیمت بازار برای سکه‌ی بانک مرکزی، حباب واقعی (بازار − ذاتی) نمایش داده می‌شود', async () => {
    const user = userEvent.setup();
    renderPage();

    const marketFields = screen.getAllByLabelText('قیمت بازار');
    await user.click(marketFields[0]!);
    for (const digit of '950000000') {
      await user.click(screen.getByRole('button', { name: `رقم ${toPersianDigits(digit)}` }));
    }

    // حباب = ۹۵۰٬۰۰۰٬۰۰۰ − ۹۰۰٬۰۰۰٬۰۰۰ = ۵۰٬۰۰۰٬۰۰۰ ریال، مثبت
    const expectedBubble = dualFromRial(50_000_000n, RATE_1000);
    await waitFor(() => expect(screen.getByText(formatGram(expectedBubble.pureMg))).toBeInTheDocument());
  });
});

describe('CoinInventoryPage — کلید تعویض واحد', () => {
  it('ارزش ذاتی با کلیک روی «ریال» به مبلغ ریالی عوض می‌شود', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('radio', { name: /ریال/ }));
    expect(screen.getByText(formatRial(900_000_000n))).toBeInTheDocument();
  });
});

describe('CoinInventoryPage — بارگذاری و خطا', () => {
  it('حین بارگذاری، اسکلت نشان داده می‌شود، نه فهرست', () => {
    useCoinTypesMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    renderPage();
    expect(screen.queryByText('تمام بهار آزادی')).not.toBeInTheDocument();
  });

  it('شکست هر کدام از دو query، خطا و «تلاش دوباره» نشان می‌دهد', async () => {
    const refetchCoinTypes = vi.fn();
    const refetchBalances = vi.fn();
    useCoinTypesMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: refetchCoinTypes });
    useInventoryBalancesMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: refetchBalances,
    });
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent('دریافت موجودی سکه ناموفق بود');
    await user.click(screen.getByRole('button', { name: 'تلاش دوباره' }));
    expect(refetchCoinTypes).toHaveBeenCalledTimes(1);
    expect(refetchBalances).toHaveBeenCalledTimes(1);
  });
});
