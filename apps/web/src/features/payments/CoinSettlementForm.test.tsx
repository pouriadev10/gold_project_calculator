import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dualFromRial, formatGram, toPersianDigits } from '@gold/core-calc';
import type * as Queries from '@/api/queries';
import type { CoinTypeVersion, PartyBalances, PriceQuote } from '@/api/contracts';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { CoinSettlementForm } from './CoinSettlementForm';

/**
 * FE-053 — پرداخت با سکه (`CoinSettlementForm`، «هر روش component مستقل
 * داشته باشد»، FE-050). فقط مرز شبکه (`@/api/settlements`) و query‌های
 * خارجی mock می‌شوند.
 */

const TEST_PARTY_ID = 'a1000000-0000-4000-8000-000000000001';

const createCoinSettlementMock = vi.fn();
vi.mock('@/api/settlements', () => ({
  createCoinSettlement: (...args: unknown[]) => createCoinSettlementMock(...args),
}));

const useCoinTypesMock = vi.fn();
const useLatestPriceQuoteMock = vi.fn();
const usePartyBalancesMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useCoinTypes: () => useCoinTypesMock(),
  useLatestPriceQuote: (...args: unknown[]) => useLatestPriceQuoteMock(...args),
  usePartyBalances: (...args: unknown[]) => usePartyBalancesMock(...args),
}));

function balances(rial: string): PartyBalances {
  return {
    partyId: TEST_PARTY_ID,
    calculatedAt: new Date().toISOString(),
    defaultDisplayUnit: 'GOLD',
    rawBalances: { rial, pureGoldMg: '0', coins: [] },
    convertedView: null,
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

async function typeDigits(user: ReturnType<typeof userEvent.setup>, digits: string) {
  for (const digit of digits) {
    await user.click(screen.getByRole('button', { name: `رقم ${toPersianDigits(digit)}` }));
  }
}

async function selectCoinType(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.selectOptions(screen.getByLabelText('نوع سکه'), title);
}

function renderForm() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <CoinSettlementForm partyId={TEST_PARTY_ID} />
      <NumericKeypad />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  createCoinSettlementMock.mockReset();
  useCoinTypesMock.mockReset();
  useLatestPriceQuoteMock.mockReset();
  usePartyBalancesMock.mockReset();

  useCoinTypesMock.mockReturnValue({ data: [BAHAR, PRIVATE], isLoading: false, isError: false, refetch: vi.fn() });
  useLatestPriceQuoteMock.mockReturnValue({ data: priceQuote(), isLoading: false, isSuccess: true });
  usePartyBalancesMock.mockReturnValue({ data: balances('45000000'), isLoading: false, isError: false });
});

describe('CoinSettlementForm — پرداخت با سکه (FE-053)', () => {
  it('حباب فقط برای سکه‌ی بانک مرکزی رندر می‌شود', async () => {
    const user = userEvent.setup();
    renderForm();

    await selectCoinType(user, BAHAR.title);
    expect(screen.getByText('حباب (هر سکه)')).toBeInTheDocument();

    await selectCoinType(user, PRIVATE.title);
    expect(screen.queryByText('حباب (هر سکه)')).not.toBeInTheDocument();
  });

  it('معادل وزنی فقط نمایشی است — دیده می‌شود ولی در payload نمی‌رود', async () => {
    createCoinSettlementMock.mockResolvedValue({
      settlementId: 's1',
      ledgerTransactionId: 'l1',
      inventoryMovementId: 'm1',
      coinTypeId: BAHAR.coinTypeId,
      count: 3,
      settledRial: 3_000_000_000n,
      intrinsicValueRial: 900_000_000n,
      bubbleRial: 100_000_000n,
    });
    const user = userEvent.setup();
    renderForm();

    await selectCoinType(user, BAHAR.title);
    await user.click(screen.getByLabelText('تعداد'));
    await typeDigits(user, '3');

    // ۳ عدد × ۱۰ گرم = ۳۰ گرم
    await waitFor(() => expect(screen.getByText(`معادل وزنی (فقط نمایشی): ${formatGram(30_000n)}`)).toBeInTheDocument());

    await user.click(screen.getByLabelText('نرخ بازار'));
    await typeDigits(user, '1000000000');
    await user.click(screen.getByRole('button', { name: 'ثبت پرداخت' }));

    await waitFor(() => expect(createCoinSettlementMock).toHaveBeenCalledTimes(1));
    const [, input] = createCoinSettlementMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.keys(input)).not.toContain('grossWeightMg');
    expect(Object.keys(input)).not.toContain('grossWeightUg');
  });

  it('پرداخت با سکه را با payload درست ثبت می‌کند — تعداد number، نه رشته‌ی وزن', async () => {
    createCoinSettlementMock.mockResolvedValue({
      settlementId: 's1',
      ledgerTransactionId: 'l1',
      inventoryMovementId: 'm1',
      coinTypeId: BAHAR.coinTypeId,
      count: 3,
      settledRial: 3_000_000_000n,
      intrinsicValueRial: 900_000_000n,
      bubbleRial: 100_000_000n,
    });
    const user = userEvent.setup();
    renderForm();

    await selectCoinType(user, BAHAR.title);
    await user.click(screen.getByLabelText('تعداد'));
    await typeDigits(user, '3');
    await user.click(screen.getByLabelText('نرخ بازار'));
    await typeDigits(user, '1000000000');
    await user.click(screen.getByRole('button', { name: 'ثبت پرداخت' }));

    await waitFor(() => expect(createCoinSettlementMock).toHaveBeenCalledTimes(1));
    const [calledPartyId, input] = createCoinSettlementMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(calledPartyId).toBe(TEST_PARTY_ID);
    expect(input).toMatchObject({
      coinTypeId: BAHAR.coinTypeId,
      count: 3,
      marketUnitPriceRial: '1000000000',
      quoteId: QUOTE_ID,
    });
    expect(typeof input['count']).toBe('number');

    await waitFor(() => expect(screen.getByText('پرداخت با سکه ثبت شد')).toBeInTheDocument());
  });

  it('double tap فقط یک فراخوانی می‌سازد', async () => {
    let resolveSettlement: (value: unknown) => void = () => {};
    createCoinSettlementMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSettlement = resolve;
      }),
    );
    const user = userEvent.setup();
    renderForm();

    await selectCoinType(user, BAHAR.title);
    await user.click(screen.getByLabelText('تعداد'));
    await typeDigits(user, '3');
    await user.click(screen.getByLabelText('نرخ بازار'));
    await typeDigits(user, '1000000000');

    const submitButton = screen.getByRole('button', { name: 'ثبت پرداخت' });
    await user.click(submitButton);
    await user.click(submitButton);

    expect(createCoinSettlementMock).toHaveBeenCalledTimes(1);
    resolveSettlement({
      settlementId: 's1',
      ledgerTransactionId: 'l1',
      inventoryMovementId: 'm1',
      coinTypeId: BAHAR.coinTypeId,
      count: 3,
      settledRial: 3_000_000_000n,
      intrinsicValueRial: 900_000_000n,
      bubbleRial: 100_000_000n,
    });
    await waitFor(() => expect(screen.getByText('پرداخت با سکه ثبت شد')).toBeInTheDocument());
  });

  it('بدون انتخاب نوع سکه، دکمه‌ی ثبت غیرفعال است', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'ثبت پرداخت' })).toBeDisabled();
  });

  it('«مانده پس از این پرداخت» را از موجودی جاری منهای معادل نمایشی می‌سازد (FE-055)', async () => {
    const user = userEvent.setup();
    renderForm();

    await selectCoinType(user, BAHAR.title);
    await user.click(screen.getByLabelText('تعداد'));
    await typeDigits(user, '3');
    await user.click(screen.getByLabelText('نرخ بازار'));
    await typeDigits(user, '1000000000');

    // مانده فعلی ۴۵٬۰۰۰٬۰۰۰ − معادل نمایشی ۳٬۰۰۰٬۰۰۰٬۰۰۰ = ۲٬۹۵۵٬۰۰۰٬۰۰۰ منفی
    await waitFor(() => expect(screen.getByText('مانده پس از این پرداخت')).toBeInTheDocument());
    const dualGram = formatGram(dualFromRial(-2_955_000_000n, 100_000_000n).pureMg);
    expect(screen.getByText(dualGram)).toBeInTheDocument();
  });
});
