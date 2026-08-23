import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toPersianDigits } from '@gold/core-calc';
import type * as Queries from '@/api/queries';
import type { PartyBalances, PriceQuote } from '@/api/contracts';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { RialSettlementForm } from './RialSettlementForm';

/**
 * FE-051 — پرداخت ریالی (`RialSettlementForm`، «هر روش component مستقل
 * داشته باشد»، FE-050). فقط مرز شبکه (`@/api/settlements`) و query‌های
 * خارجی mock می‌شوند؛ `useIdempotentSubmit` واقعی می‌ماند چون خودش
 * «double tap یک تسویه‌ی دوم نسازد» را تضمین می‌کند.
 */

const TEST_PARTY_ID = 'a1000000-0000-4000-8000-000000000001';

const createRialSettlementMock = vi.fn();
vi.mock('@/api/settlements', () => ({
  createRialSettlement: (...args: unknown[]) => createRialSettlementMock(...args),
}));

const usePartyBalancesMock = vi.fn();
const useLatestPriceQuoteMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  usePartyBalances: (...args: unknown[]) => usePartyBalancesMock(...args),
  useLatestPriceQuote: (...args: unknown[]) => useLatestPriceQuoteMock(...args),
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

function priceQuote(): PriceQuote {
  return {
    id: 'c1000000-0000-4000-8000-000000000001',
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

/** `RialSettlementForm` عمداً کیپد خودش را ندارد — یک slot مستقل است که در صفحه‌ی میزبان (FE-055) کنار یک `<NumericKeypad />` مشترک می‌نشیند */
function renderForm() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <RialSettlementForm partyId={TEST_PARTY_ID} />
      <NumericKeypad />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  createRialSettlementMock.mockReset();
  usePartyBalancesMock.mockReset();
  useLatestPriceQuoteMock.mockReset();

  usePartyBalancesMock.mockReturnValue({ data: balances('45000000'), isLoading: false, isError: false });
  useLatestPriceQuoteMock.mockReturnValue({ data: priceQuote(), isLoading: false, isSuccess: true });
});

describe('RialSettlementForm — پرداخت ریالی (FE-051)', () => {
  it('«پرداخت کامل» مبلغ را برابر مانده‌ی بدهکار جاری می‌کند', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: 'پرداخت کامل' }));
    createRialSettlementMock.mockResolvedValue({
      settlementId: 's1',
      ledgerTransactionId: 'l1',
      amountRial: 45_000_000n,
    });

    await user.click(screen.getByRole('button', { name: 'ثبت پرداخت' }));
    await waitFor(() => expect(createRialSettlementMock).toHaveBeenCalledTimes(1));
    expect(createRialSettlementMock.mock.calls[0]?.[1]).toMatchObject({ amountRial: '45000000' });
  });

  it('مبلغ ناقص (کمتر از مانده) هم قابل ثبت است — بدون سقف سمت کلاینت', async () => {
    createRialSettlementMock.mockResolvedValue({ settlementId: 's1', ledgerTransactionId: 'l1', amountRial: 20_000_000n });
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByLabelText('مبلغ'));
    await typeDigits(user, '20000000');
    await user.click(screen.getByRole('button', { name: 'ثبت پرداخت' }));

    await waitFor(() => expect(createRialSettlementMock).toHaveBeenCalledTimes(1));
    expect(createRialSettlementMock.mock.calls[0]?.[0]).toBe(TEST_PARTY_ID);
    expect(createRialSettlementMock.mock.calls[0]?.[1]).toMatchObject({ amountRial: '20000000' });
    await waitFor(() => expect(screen.getByText('پرداخت ریالی ثبت شد')).toBeInTheDocument());
  });

  it('بدون مبلغ، دکمه‌ی ثبت غیرفعال است', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'ثبت پرداخت' })).toBeDisabled();
  });

  it('double tap فقط یک فراخوانی می‌سازد', async () => {
    let resolveSettlement: (value: unknown) => void = () => {};
    createRialSettlementMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSettlement = resolve;
      }),
    );
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByLabelText('مبلغ'));
    await typeDigits(user, '1000000');

    const submitButton = screen.getByRole('button', { name: 'ثبت پرداخت' });
    await user.click(submitButton);
    await user.click(submitButton);

    expect(createRialSettlementMock).toHaveBeenCalledTimes(1);
    resolveSettlement({ settlementId: 's1', ledgerTransactionId: 'l1', amountRial: 1_000_000n });
    await waitFor(() => expect(screen.getByText('پرداخت ریالی ثبت شد')).toBeInTheDocument());
  });

  it('وقتی شخص بستانکار است (مانده صفر/منفی)، «پرداخت کامل» غیرفعال است', () => {
    usePartyBalancesMock.mockReturnValue({ data: balances('0'), isLoading: false, isError: false });
    renderForm();
    expect(screen.getByRole('button', { name: 'پرداخت کامل' })).toBeDisabled();
  });
});
