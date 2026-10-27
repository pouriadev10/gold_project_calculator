import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { dualFromPure, dualFromRial } from '@gold/core-calc';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type * as ReactRouter from '@tanstack/react-router';
import type { PartyBalanceReport, PartyBalanceReportQuery } from '@/api/contracts';
import type * as Queries from '@/api/queries';
import { useUnitStore } from '@/stores/unit-store';
import CreditorsPage from './CreditorsPage';

/**
 * FE-073 — فهرست بستانکاران. تمرکز روی معنای درست بستانکاری: endpoint،
 * متن‌ها و نبود علامت منفیِ معنادار. منطق مشترک (جست‌وجو، صفحه‌بندی، نبود
 * درخواست تازه با کلید واحد) در `DebtorsPage.test.tsx` پوشش داده شده است.
 */

const QUOTE_ID = 'c1000000-0000-4000-8000-000000000001';
const RATE = 4_800_000n;

const useQueryMocks = {
  useLatestPriceQuote: vi.fn(),
  usePartyBalanceReport: vi.fn(),
};
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useLatestPriceQuote: (...args: unknown[]) => useQueryMocks.useLatestPriceQuote(...args),
  usePartyBalanceReport: (...args: unknown[]) => useQueryMocks.usePartyBalanceReport(...args),
  // نام فارسی سکه‌ها (M-28) از فهرست انواع می‌آید؛ اینجا فهرست خالی است و کد نمایش داده می‌شود.
  useCoinTypes: () => ({ data: [] }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return {
    ...actual,
    Link: ({ to, params, children, ...rest }: { to: string; params?: Record<string, string>; children?: ReactNode }) => (
      <a href={to.replace('$partyId', params?.['partyId'] ?? '')} {...rest}>
        {children}
      </a>
    ),
  };
});

const ZAHRA = 'a1000000-0000-4000-8000-000000000002';
const HOSSEIN = 'a1000000-0000-4000-8000-000000000001';

/** زهرا: طلای خالص بستانکار، ریال بدهکار — جمع معادل بستانکار. */
const ZAHRA_RIAL = 1_000_000n;
const ZAHRA_GOLD = -86_000n;
const ZAHRA_DISPLAY_GOLD = ZAHRA_GOLD + dualFromRial(ZAHRA_RIAL, RATE).pureMg;

function report(overrides: Partial<PartyBalanceReport> = {}): PartyBalanceReport {
  return {
    direction: 'CREDITOR',
    displayUnit: 'GOLD',
    referenceMazneh: {
      id: QUOTE_ID,
      amountRial: '480000000',
      observedAt: '2026-10-10T08:00:00.000Z',
      goldRatePerGramRial: RATE.toString(),
    },
    items: [
      {
        party: { id: ZAHRA, displayName: 'زهرا کریمی', type: 'CONSUMER', status: 'ACTIVE', mobile: null },
        rawBalances: { rial: ZAHRA_RIAL.toString(), pureGoldMg: ZAHRA_GOLD.toString(), coins: [] },
        displayBalance: ZAHRA_DISPLAY_GOLD.toString(),
        convertibleDirection: 'CREDITOR',
        coinsRemainSeparate: true,
      },
      {
        // حسین در کل بدهکار است ولی یک نیم‌سکه از فروشگاه طلب دارد.
        party: { id: HOSSEIN, displayName: 'حسین مرادی', type: 'CONSUMER', status: 'ACTIVE', mobile: null },
        rawBalances: {
          rial: '0',
          pureGoldMg: '412500',
          coins: [{ coinTypeId: 'c3000000-0000-4000-8000-000000000002', code: 'NIM', count: -1 }],
        },
        displayBalance: '412500',
        convertibleDirection: 'DEBTOR',
        coinsRemainSeparate: true,
      },
    ],
    total: 2,
    limit: 20,
    offset: 0,
    ...overrides,
  };
}

let reportResponse: { data: PartyBalanceReport | undefined; isLoading: boolean; isError: boolean; isPlaceholderData: boolean; refetch: () => void };

beforeEach(() => {
  useUnitStore.setState({ unit: 'gold' });
  reportResponse = { data: report(), isLoading: false, isError: false, isPlaceholderData: false, refetch: vi.fn() };
  useQueryMocks.useLatestPriceQuote.mockReset();
  useQueryMocks.useLatestPriceQuote.mockReturnValue({
    data: { id: QUOTE_ID, amountRial: '480000000', observedAt: '2026-10-10T08:00:00.000Z' },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  useQueryMocks.usePartyBalanceReport.mockReset();
  useQueryMocks.usePartyBalanceReport.mockImplementation(() => reportResponse);
});

function cards() {
  return screen.getAllByRole('listitem').filter((node) => node.closest('ul[aria-label]') === null);
}

describe('CreditorsPage — FE-073', () => {
  it('asks the creditors endpoint, not the debtors one', () => {
    render(<CreditorsPage />);

    const [direction, query] = useQueryMocks.usePartyBalanceReport.mock.calls.at(-1) as [
      string,
      PartyBalanceReportQuery,
    ];
    expect(direction).toBe('CREDITOR');
    expect(query).toEqual({
      limit: 20,
      offset: 0,
      displayUnit: 'GOLD',
      referenceQuoteId: QUOTE_ID,
      sortDirection: 'DESC',
    });
  });

  it('uses creditor wording everywhere and never debtor wording', () => {
    render(<CreditorsPage />);

    expect(screen.getByRole('heading', { name: 'بستانکاران' })).toBeInTheDocument();
    expect(screen.getByText('بستانکار یعنی فروشگاه به این شخص بدهکار است.')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'بیشترین طلب' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'کمترین طلب' })).toBeInTheDocument();
    expect(screen.queryByText(/بدهی/)).not.toBeInTheDocument();
    expect(screen.getByText(/۲ بستانکار/)).toBeInTheDocument();
    expect(screen.getByText('به‌خاطر سکه‌ی بستانکار در فهرست است')).toBeInTheDocument();
    expect(screen.queryByText('به‌خاطر سکه‌ی بدهکار در فهرست است')).not.toBeInTheDocument();
  });

  it('shows what the shop owes as a magnitude with an explicit direction label', async () => {
    const user = userEvent.setup();
    render(<CreditorsPage />);

    const zahra = cards()[0]!;
    // مانده‌ی معادل: اندازه‌ی مثبت + «بستانکار»، نه عدد منفی.
    expect(zahra.querySelector(`[data-raw="${-ZAHRA_DISPLAY_GOLD}"][data-unit="gold"]`)).not.toBeNull();
    expect(zahra.querySelector(`[data-raw="${ZAHRA_DISPLAY_GOLD}"]`)).toBeNull();
    // ابعاد خام هم اندازه + جهت خودشان: طلا بستانکار، ریال بدهکار.
    expect(zahra.querySelector(`[data-raw="${-ZAHRA_GOLD}"][data-unit="gold"]`)).not.toBeNull();
    expect(zahra.querySelector(`[data-raw="${ZAHRA_RIAL}"][data-unit="rial"]`)).not.toBeNull();
    expect(within(zahra).getAllByText('بستانکار')).toHaveLength(2);
    expect(within(zahra).getByText('بدهکار')).toBeInTheDocument();
    expect(zahra).not.toHaveTextContent('−');

    await user.click(screen.getByRole('radio', { name: /ریال/ }));
    const expectedRial = -(ZAHRA_RIAL + dualFromPure(ZAHRA_GOLD, RATE).rial);
    expect(cards()[0]!.querySelector(`[data-raw="${expectedRial}"][data-unit="rial"]`)).not.toBeNull();
    expect(cards()[0]).not.toHaveTextContent('−');
  });

  it('keeps the creditor coin separate and labelled even when the party is a debtor overall', () => {
    render(<CreditorsPage />);

    const hossein = cards()[1]!;
    expect(within(hossein).getByText('بدهکار', { selector: 'span.font-medium' })).toBeInTheDocument();
    const coin = within(within(hossein).getByRole('list', { name: 'مانده سکه‌ها' })).getByRole('listitem');
    expect(coin).toHaveTextContent('NIM');
    expect(coin).toHaveTextContent('۱');
    expect(coin).toHaveTextContent('بستانکار');
    expect(coin).not.toHaveTextContent('−');
  });

  it('uses creditor wording for empty, error and mismatched responses', () => {
    reportResponse = { ...reportResponse, data: report({ items: [], total: 0 }) };
    const { rerender } = render(<CreditorsPage />);
    expect(screen.getByText('بستانکاری پیدا نشد')).toBeInTheDocument();
    expect(screen.getByText('در حال حاضر فروشگاه به هیچ شخصی بدهکار نیست.')).toBeInTheDocument();

    reportResponse = { ...reportResponse, data: undefined, isError: true };
    rerender(<CreditorsPage />);
    expect(screen.getByText('دریافت فهرست بستانکاران ناموفق بود.')).toBeInTheDocument();

    // پاسخ بدهکاران هرگز به‌جای بستانکاران نمایش داده نمی‌شود.
    reportResponse = { ...reportResponse, data: report({ direction: 'DEBTOR' }), isError: false };
    rerender(<CreditorsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('پاسخ دریافتی فهرست بستانکاران نیست.');
    expect(screen.queryByRole('link', { name: 'زهرا کریمی' })).not.toBeInTheDocument();
  });
});
