import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toPersianDigits } from '@gold/core-calc';
import type * as Queries from '@/api/queries';
import type { PriceQuote } from '@/api/contracts';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { GoldSettlementForm } from './GoldSettlementForm';

/**
 * FE-052 — پرداخت با طلا (`GoldSettlementForm`، «هر روش component مستقل
 * داشته باشد»، FE-050). فقط مرز شبکه (`@/api/settlements`) و
 * `useLatestPriceQuote` (زیرِ `useMazneh`) mock می‌شوند.
 */

const TEST_PARTY_ID = 'a1000000-0000-4000-8000-000000000001';

const createGoldSettlementMock = vi.fn();
vi.mock('@/api/settlements', () => ({
  createGoldSettlement: (...args: unknown[]) => createGoldSettlementMock(...args),
}));

const useLatestPriceQuoteMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useLatestPriceQuote: (...args: unknown[]) => useLatestPriceQuoteMock(...args),
}));

/** `324885150` → `gramRate1000` واقعی دقیقاً `100_000_000` می‌دهد، بدون گرد کردن. */
function priceQuote(id: string, amountRial: bigint): PriceQuote {
  return {
    id,
    quoteType: 'MAZNEH',
    amountRial,
    source: 'MANUAL',
    observedAt: '2026-08-20T08:00:00+00:00',
    createdBy: null,
    createdAt: '2026-08-20T08:00:00+00:00',
  };
}

const QUOTE_A = priceQuote('c1000000-0000-4000-8000-000000000001', 324_885_150n);
const QUOTE_B = priceQuote('c1000000-0000-4000-8000-000000000002', 649_770_300n); // rate1000 دوبرابر

async function typeDigits(user: ReturnType<typeof userEvent.setup>, digits: string) {
  for (const digit of digits) {
    await user.click(screen.getByRole('button', { name: `رقم ${toPersianDigits(digit)}` }));
  }
}

async function fillWeightAndKarat(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText('وزن'));
  // کیپد وزن سه رقم اعشار ضمنی دارد (گرم)؛ بدون جداکننده، رقم‌های تایپ‌شده
  // بخش صحیح (گرم) می‌شوند و خودکار ×۱۰۰۰ به میلی‌گرم تبدیل می‌شوند — یعنی
  // «۱۰» همان ۱۰ گرم = ۱۰٬۰۰۰ میلی‌گرم است، نه «۱۰۰۰۰».
  await typeDigits(user, '10');
  await user.click(screen.getByLabelText('عیار'));
  await typeDigits(user, '900');
}

function renderForm() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <GoldSettlementForm partyId={TEST_PARTY_ID} />
      <NumericKeypad />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  createGoldSettlementMock.mockReset();
  useLatestPriceQuoteMock.mockReset();
  useLatestPriceQuoteMock.mockReturnValue({ data: QUOTE_A, isLoading: false, isSuccess: true });
});

describe('GoldSettlementForm — پرداخت با طلا (FE-052)', () => {
  it('معادل نمایشی و نرخ ردیف را با فرمول واقعی core-calc نشان می‌دهد', async () => {
    const user = userEvent.setup();
    renderForm();

    await fillWeightAndKarat(user);

    // ۱۰ گرم × عیار ۹۰۰ = ۹ گرم خالص × نرخ ۱۰۰٬۰۰۰٬۰۰۰ = ۹۰۰٬۰۰۰٬۰۰۰ ریال
    await waitFor(() => expect(screen.getByText('۱۰۰٬۰۰۰٬۰۰۰ ریال/گرم')).toBeInTheDocument());
  });

  it('پس از قفل، تغییر مظنه‌ی زنده پیش‌نمایش را عوض نمی‌کند', async () => {
    const user = userEvent.setup();
    const { rerender } = renderForm();

    await fillWeightAndKarat(user);
    await waitFor(() => expect(screen.getByText('۱۰۰٬۰۰۰٬۰۰۰ ریال/گرم')).toBeInTheDocument());

    // مظنه‌ی زنده عوض می‌شود؛ نرخ قفل‌شده باید همان بماند
    useLatestPriceQuoteMock.mockReturnValue({ data: QUOTE_B, isLoading: false, isSuccess: true });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <GoldSettlementForm partyId={TEST_PARTY_ID} />
        <NumericKeypad />
      </QueryClientProvider>,
    );

    expect(screen.getByText('۱۰۰٬۰۰۰٬۰۰۰ ریال/گرم')).toBeInTheDocument();
    expect(screen.queryByText('۲۰۰٬۰۰۰٬۰۰۰ ریال/گرم')).not.toBeInTheDocument();
  });

  it('پرداخت با طلا را با payload درست ثبت می‌کند — وزن string، عیار number', async () => {
    createGoldSettlementMock.mockResolvedValue({
      settlementId: 's1',
      ledgerTransactionId: 'l1',
      inventoryMovementId: 'm1',
      pureWeightMg: 9_000n,
      settledRial: 900_000_000n,
      goldRatePerGramRial: 100_000_000n,
    });
    const user = userEvent.setup();
    renderForm();

    await fillWeightAndKarat(user);
    await user.click(screen.getByRole('button', { name: 'ثبت پرداخت' }));

    await waitFor(() => expect(createGoldSettlementMock).toHaveBeenCalledTimes(1));
    const [calledPartyId, input] = createGoldSettlementMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(calledPartyId).toBe(TEST_PARTY_ID);
    expect(input).toMatchObject({
      grossWeightMg: '10000',
      karat: 900,
      quoteId: QUOTE_A.id,
    });
    expect(typeof input['karat']).toBe('number');
    expect(typeof input['grossWeightMg']).toBe('string');

    await waitFor(() => expect(screen.getByText('پرداخت با طلا ثبت شد')).toBeInTheDocument());
  });

  it('double tap فقط یک فراخوانی می‌سازد', async () => {
    let resolveSettlement: (value: unknown) => void = () => {};
    createGoldSettlementMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSettlement = resolve;
      }),
    );
    const user = userEvent.setup();
    renderForm();

    await fillWeightAndKarat(user);
    const submitButton = screen.getByRole('button', { name: 'ثبت پرداخت' });
    await user.click(submitButton);
    await user.click(submitButton);

    expect(createGoldSettlementMock).toHaveBeenCalledTimes(1);
    resolveSettlement({
      settlementId: 's1',
      ledgerTransactionId: 'l1',
      inventoryMovementId: 'm1',
      pureWeightMg: 9_000n,
      settledRial: 900_000_000n,
      goldRatePerGramRial: 100_000_000n,
    });
    await waitFor(() => expect(screen.getByText('پرداخت با طلا ثبت شد')).toBeInTheDocument());
  });

  it('بدون وزن، دکمه‌ی ثبت غیرفعال است', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'ثبت پرداخت' })).toBeDisabled();
  });
});
