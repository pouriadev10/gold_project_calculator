import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toPersianDigits } from '@gold/core-calc';
import type * as Queries from '@/api/queries';
import type { CoinTypeVersion, PartyBalances, PriceQuote } from '@/api/contracts';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { MixedSettlementForm } from './MixedSettlementForm';

/**
 * FE-054 — تسویه‌ی ترکیبی (`MixedSettlementForm`، «هر روش component
 * مستقل داشته باشد»، FE-050). فقط مرز شبکه (`@/api/settlements`) و
 * query‌های خارجی mock می‌شوند.
 */

const TEST_PARTY_ID = 'a1000000-0000-4000-8000-000000000001';

const createMixedSettlementMock = vi.fn();
vi.mock('@/api/settlements', () => ({
  createMixedSettlement: (...args: unknown[]) => createMixedSettlementMock(...args),
}));

const useCoinTypesMock = vi.fn();
const usePartyBalancesMock = vi.fn();
const useLatestPriceQuoteMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useCoinTypes: () => useCoinTypesMock(),
  usePartyBalances: (...args: unknown[]) => usePartyBalancesMock(...args),
  useLatestPriceQuote: (...args: unknown[]) => useLatestPriceQuoteMock(...args),
}));

const BAHAR: CoinTypeVersion = {
  id: 'v-bahar',
  coinTypeId: 'c-bahar',
  code: 'BAHAR',
  title: 'تمام بهار آزادی',
  grossWeightUg: '10000000',
  karat: 900,
  validFrom: '2026-07-30T09:00:00+00:00',
  validTo: null,
  version: 1,
  active: true,
  mintType: 'CENTRAL_BANK',
  isCentralBankMinted: true,
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

function balances(rial: string): PartyBalances {
  return {
    partyId: TEST_PARTY_ID,
    calculatedAt: new Date().toISOString(),
    defaultDisplayUnit: 'GOLD',
    rawBalances: { rial, pureGoldMg: '0', coins: [] },
    convertedView: null,
  };
}

async function typeDigits(user: ReturnType<typeof userEvent.setup>, digits: string) {
  for (const digit of digits) {
    await user.click(screen.getByRole('button', { name: `رقم ${toPersianDigits(digit)}` }));
  }
}

function renderForm() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MixedSettlementForm partyId={TEST_PARTY_ID} />
      <NumericKeypad />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  createMixedSettlementMock.mockReset();
  useCoinTypesMock.mockReset();
  usePartyBalancesMock.mockReset();
  useLatestPriceQuoteMock.mockReset();

  useCoinTypesMock.mockReturnValue({ data: [BAHAR], isLoading: false, isError: false, refetch: vi.fn() });
  usePartyBalancesMock.mockReturnValue({ data: balances('45000000'), isLoading: false, isError: false });
  useLatestPriceQuoteMock.mockReturnValue({ data: priceQuote(), isLoading: false, isSuccess: true });
});

describe('MixedSettlementForm — تسویه‌ی ترکیبی (FE-054)', () => {
  it('بدون هیچ ردیفی، ثبت غیرفعال است', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'ثبت تسویه‌ی ترکیبی' })).toBeDisabled();
  });

  it('یک ردیف ریال اضافه و حذف می‌شود', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: '+ ریال' }));
    expect(screen.getByRole('button', { name: 'حذف ردیف ریال' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'حذف ردیف ریال' }));
    expect(screen.queryByRole('button', { name: 'حذف ردیف ریال' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ثبت تسویه‌ی ترکیبی' })).toBeDisabled();
  });

  it('بدون مانده‌ی اعتباری، افزودن ردیف «مانده اعتباری» غیرفعال است', () => {
    usePartyBalancesMock.mockReturnValue({ data: balances('45000000'), isLoading: false, isError: false });
    renderForm();
    expect(screen.getByRole('button', { name: '+ مانده اعتباری' })).toBeDisabled();
  });

  it('مبلغ ردیف اعتباری بیشتر از مانده، خطای همان ردیف را نشان می‌دهد', async () => {
    // شخص ۲۰ میلیون بستانکار است (رقم منفی) — سقف ردیف اعتباری همین است
    usePartyBalancesMock.mockReturnValue({ data: balances('-20000000'), isLoading: false, isError: false });
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: '+ مانده اعتباری' }));
    await user.click(screen.getByLabelText('مبلغ'));
    await typeDigits(user, '30000000');

    expect(screen.getByText('بیشتر از مانده‌ی اعتباری موجود شخص است.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ثبت تسویه‌ی ترکیبی' })).toBeDisabled();
  });

  it('ریال + طلا + سکه را در یک درخواست با یک Idempotency-Key ثبت می‌کند', async () => {
    createMixedSettlementMock.mockResolvedValue({
      settlementId: 's1',
      ledgerTransactionId: 'l1',
      totalSettledRial: 4_000_000_000n,
      lines: [
        { type: 'RIAL', settledRial: 1_000_000_000n },
        { type: 'GOLD', inventoryMovementId: 'm1', pureWeightMg: 9_000n, settledRial: 900_000_000n, goldRatePerGramRial: 100_000_000n },
        { type: 'COIN', inventoryMovementId: 'm2', coinTypeId: BAHAR.coinTypeId, count: 3, settledRial: 3_000_000_000n, intrinsicValueRial: 900_000_000n, bubbleRial: 100_000_000n },
      ],
    });
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: '+ ریال' }));
    await user.click(screen.getByLabelText('مبلغ'));
    await typeDigits(user, '1000000000');

    await user.click(screen.getByRole('button', { name: '+ طلا' }));
    await user.click(screen.getByLabelText('وزن'));
    await typeDigits(user, '10');
    await user.click(screen.getByLabelText('عیار'));
    await typeDigits(user, '900');

    await user.click(screen.getByRole('button', { name: '+ سکه' }));
    await user.selectOptions(screen.getByLabelText('نوع سکه'), BAHAR.title);
    await user.click(screen.getByLabelText('تعداد'));
    await typeDigits(user, '3');
    await user.click(screen.getByLabelText('نرخ بازار'));
    await typeDigits(user, '1000000000');

    await user.click(screen.getByRole('button', { name: 'ثبت تسویه‌ی ترکیبی' }));

    await waitFor(() => expect(createMixedSettlementMock).toHaveBeenCalledTimes(1));
    const [calledPartyId, input, key] = createMixedSettlementMock.mock.calls[0] as [string, { lines: unknown[] }, string];
    expect(calledPartyId).toBe(TEST_PARTY_ID);
    expect(input.lines).toHaveLength(3);
    expect(typeof key).toBe('string');

    await waitFor(() => expect(screen.getByText('تسویه‌ی ترکیبی ثبت شد')).toBeInTheDocument());
  });

  it('double tap فقط یک فراخوانی می‌سازد', async () => {
    let resolveSettlement: (value: unknown) => void = () => {};
    createMixedSettlementMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSettlement = resolve;
      }),
    );
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: '+ ریال' }));
    await user.click(screen.getByLabelText('مبلغ'));
    await typeDigits(user, '1000000');

    const submitButton = screen.getByRole('button', { name: 'ثبت تسویه‌ی ترکیبی' });
    await user.click(submitButton);
    await user.click(submitButton);

    expect(createMixedSettlementMock).toHaveBeenCalledTimes(1);
    resolveSettlement({ settlementId: 's1', ledgerTransactionId: 'l1', totalSettledRial: 1_000_000n, lines: [{ type: 'RIAL', settledRial: 1_000_000n }] });
    await waitFor(() => expect(screen.getByText('تسویه‌ی ترکیبی ثبت شد')).toBeInTheDocument());
  });
});
