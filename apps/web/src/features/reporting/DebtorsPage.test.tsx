import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { dualFromPure, dualFromRial } from '@gold/core-calc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type * as ReactRouter from '@tanstack/react-router';
import type { PartyBalanceReport, PartyBalanceReportQuery } from '@/api/contracts';
import type * as Queries from '@/api/queries';
import { useUnitStore } from '@/stores/unit-store';
import DebtorsPage from './DebtorsPage';

/**
 * FE-072 — فهرست بدهکاران.
 *
 * `useLatestPriceQuote` و `usePartyBalanceReport` مستقیم mock می‌شوند.
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
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return {
    ...actual,
    Link: ({
      to,
      params,
      children,
      ...rest
    }: {
      to: string;
      params?: Record<string, string>;
      children?: ReactNode;
    }) => (
      <a href={to.replace('$partyId', params?.['partyId'] ?? '')} {...rest}>
        {children}
      </a>
    ),
  };
});

const HOSSEIN = 'a1000000-0000-4000-8000-000000000001';
const MARYAM = 'a1000000-0000-4000-8000-000000000002';

function party(id: string, displayName: string) {
  return { id, displayName, type: 'CONSUMER' as const, status: 'ACTIVE' as const, mobile: null };
}

/** حسین: ریال و طلا هر دو بدهکار، با یک سکه‌ی بدهکار و یک سکه‌ی بستانکار. */
const HOSSEIN_RIAL = 12_000_000n;
const HOSSEIN_GOLD = 2_500n;
const HOSSEIN_DISPLAY_GOLD = HOSSEIN_GOLD + dualFromRial(HOSSEIN_RIAL, RATE).pureMg;

function report(overrides: Partial<PartyBalanceReport> = {}): PartyBalanceReport {
  return {
    direction: 'DEBTOR',
    displayUnit: 'GOLD',
    referenceMazneh: {
      id: QUOTE_ID,
      amountRial: '480000000',
      observedAt: '2026-10-10T08:00:00.000Z',
      goldRatePerGramRial: RATE.toString(),
    },
    items: [
      {
        party: party(HOSSEIN, 'حسین مرادی'),
        rawBalances: {
          rial: HOSSEIN_RIAL.toString(),
          pureGoldMg: HOSSEIN_GOLD.toString(),
          coins: [
            { coinTypeId: 'c3000000-0000-4000-8000-000000000001', code: 'BAHAR', count: 2 },
            { coinTypeId: 'c3000000-0000-4000-8000-000000000002', code: 'NIM', count: -1 },
          ],
        },
        displayBalance: HOSSEIN_DISPLAY_GOLD.toString(),
        convertibleDirection: 'DEBTOR',
        coinsRemainSeparate: true,
      },
      {
        party: party(MARYAM, 'مریم کاظمی'),
        rawBalances: {
          rial: '0',
          pureGoldMg: '0',
          coins: [{ coinTypeId: 'c3000000-0000-4000-8000-000000000001', code: 'BAHAR', count: 1 }],
        },
        displayBalance: '0',
        convertibleDirection: 'SETTLED',
        coinsRemainSeparate: true,
      },
    ],
    total: 2,
    limit: 20,
    offset: 0,
    ...overrides,
  };
}

function result(data: PartyBalanceReport | undefined, overrides: Record<string, unknown> = {}) {
  return { data, isLoading: false, isError: false, isPlaceholderData: false, refetch: vi.fn(), ...overrides };
}

function quoteResult(overrides: Record<string, unknown> = {}) {
  return {
    data: { id: QUOTE_ID, amountRial: '480000000', observedAt: '2026-10-10T08:00:00.000Z' },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

function queries(): PartyBalanceReportQuery[] {
  return useQueryMocks.usePartyBalanceReport.mock.calls.map((call) => call[1] as PartyBalanceReportQuery);
}

function lastQuery(): PartyBalanceReportQuery | undefined {
  return queries().at(-1);
}

function stubViewport(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: desktop && query.includes('640px'),
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

let reportResponse: ReturnType<typeof result>;

beforeEach(() => {
  useUnitStore.setState({ unit: 'gold' });
  reportResponse = result(report());
  useQueryMocks.useLatestPriceQuote.mockReset();
  useQueryMocks.useLatestPriceQuote.mockReturnValue(quoteResult());
  useQueryMocks.usePartyBalanceReport.mockReset();
  useQueryMocks.usePartyBalanceReport.mockImplementation(() => reportResponse);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DebtorsPage — FE-072', () => {
  it('asks the debtors report with the latest mazneh, a fixed unit and descending order', () => {
    render(<DebtorsPage />);

    expect(screen.getByRole('heading', { name: 'بدهکاران' })).toBeInTheDocument();
    expect(screen.getByText('بدهکار یعنی این شخص به فروشگاه بدهکار است.')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'بیشترین بدهی' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'واحد نمایش اعداد' })).toBeInTheDocument();
    expect(useQueryMocks.useLatestPriceQuote).toHaveBeenCalledWith('MAZNEH');
    expect(useQueryMocks.usePartyBalanceReport).toHaveBeenCalledWith('DEBTOR', {
      limit: 20,
      offset: 0,
      displayUnit: 'GOLD',
      referenceQuoteId: QUOTE_ID,
      sortDirection: 'DESC',
    });
  });

  it('toggling the unit changes only the display — same query, same row order, raw dimensions untouched', async () => {
    const user = userEvent.setup();
    render(<DebtorsPage />);

    const cards = () => screen.getAllByRole('listitem').filter((node) => node.closest('ul[aria-label]') === null);
    const namesBefore = cards().map((card) => within(card).getAllByRole('link')[0]!.textContent);
    expect(cards()[0]!.querySelector(`[data-raw="${HOSSEIN_DISPLAY_GOLD}"][data-unit="gold"]`)).not.toBeNull();

    await user.click(screen.getByRole('radio', { name: /ریال/ }));

    const expectedRial = HOSSEIN_RIAL + dualFromPure(HOSSEIN_GOLD, RATE).rial;
    const first = cards()[0]!;
    expect(first.querySelector(`[data-raw="${expectedRial}"][data-unit="rial"]`)).not.toBeNull();
    // ابعاد اصلی خام می‌مانند.
    expect(first.querySelector(`[data-raw="${HOSSEIN_RIAL}"][data-unit="rial"]`)).not.toBeNull();
    expect(first.querySelector(`[data-raw="${HOSSEIN_GOLD}"][data-unit="gold"]`)).not.toBeNull();

    expect(cards().map((card) => within(card).getAllByRole('link')[0]!.textContent)).toEqual(namesBefore);
    expect(new Set(queries().map((query) => JSON.stringify(query))).size).toBe(1);
  });

  it('keeps each coin type separate with its own direction, and explains coin-only listing', () => {
    render(<DebtorsPage />);

    const [hossein, maryam] = screen.getAllByRole('list', { name: 'مانده سکه‌ها' });
    const hosseinCoins = within(hossein!).getAllByRole('listitem');
    expect(hosseinCoins).toHaveLength(2);
    expect(hosseinCoins[0]).toHaveTextContent('BAHAR');
    expect(hosseinCoins[0]).toHaveTextContent('بدهکار');
    expect(hosseinCoins[1]).toHaveTextContent('NIM');
    expect(hosseinCoins[1]).toHaveTextContent('بستانکار');
    expect(within(maryam!).getAllByRole('listitem')).toHaveLength(1);

    expect(screen.getAllByText('به‌خاطر سکه‌ی بدهکار در فهرست است')).toHaveLength(1);
    // مریم: مانده‌ی معادل، ریال و طلای خالص هر سه صفر و «تسویه».
    expect(screen.getAllByText('تسویه')).toHaveLength(3);
    // تعداد سکه‌ی بستانکار با اندازه نمایش داده می‌شود؛ جهت را برچسب می‌گوید، نه علامت.
    expect(hosseinCoins[1]).toHaveTextContent('۱');
    expect(hosseinCoins[1]).not.toHaveTextContent('−');
  });

  it('opens the party from its name', () => {
    render(<DebtorsPage />);
    expect(screen.getByRole('link', { name: 'حسین مرادی' })).toHaveAttribute('href', `/parties/${HOSSEIN}`);
  });

  it('sends debounced search and sort to the server and resets the page', async () => {
    const user = userEvent.setup();
    reportResponse = result(report({ total: 45 }));
    render(<DebtorsPage />);

    await user.click(screen.getByRole('button', { name: /بعدی/ }));
    expect(lastQuery()).toMatchObject({ offset: 20 });

    await user.selectOptions(screen.getByLabelText('مرتب‌سازی'), 'ASC');
    expect(lastQuery()).toMatchObject({ offset: 0, sortDirection: 'ASC' });

    await user.type(screen.getByLabelText('جست‌وجوی نام شخص'), '  مرادی ');
    await waitFor(() =>
      expect(lastQuery()).toEqual({
        limit: 20,
        offset: 0,
        displayUnit: 'GOLD',
        referenceQuoteId: QUOTE_ID,
        sortDirection: 'ASC',
        search: 'مرادی',
      }),
    );
  });

  it('shows page position and disables paging while the next page loads', () => {
    reportResponse = result(report({ total: 45, offset: 20 }), { isPlaceholderData: true });
    render(<DebtorsPage />);

    expect(screen.getByText('صفحه ۲ از ۳')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /قبلی/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /بعدی/ })).toBeDisabled();
  });

  it('renders a table on desktop', () => {
    stubViewport(true);
    render(<DebtorsPage />);

    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('طلای خالص')).toBeInTheDocument();
  });

  it('needs a reference mazneh before asking for the report', async () => {
    useQueryMocks.useLatestPriceQuote.mockReturnValue(quoteResult({ data: null }));
    const { rerender } = render(<DebtorsPage />);
    expect(screen.getByText('مظنه‌ای ثبت نشده')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'رفتن به مظنه' })).toHaveAttribute('href', '/pricing');
    expect(useQueryMocks.usePartyBalanceReport).not.toHaveBeenCalled();

    const refetch = vi.fn();
    useQueryMocks.useLatestPriceQuote.mockReturnValue(quoteResult({ data: undefined, isError: true, refetch }));
    rerender(<DebtorsPage />);
    await userEvent.setup().click(screen.getByRole('button', { name: /تلاش/ }));
    expect(refetch).toHaveBeenCalled();
    expect(useQueryMocks.usePartyBalanceReport).not.toHaveBeenCalled();
  });

  it('shows empty, error, mismatched-direction and loading states', () => {
    reportResponse = result(report({ items: [], total: 0 }));
    const { rerender } = render(<DebtorsPage />);
    expect(screen.getByText('بدهکاری پیدا نشد')).toBeInTheDocument();

    reportResponse = result(undefined, { isError: true });
    rerender(<DebtorsPage />);
    expect(screen.getByText('دریافت فهرست بدهکاران ناموفق بود.')).toBeInTheDocument();

    reportResponse = result(report({ direction: 'CREDITOR' }));
    rerender(<DebtorsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('پاسخ دریافتی فهرست بدهکاران نیست.');

    reportResponse = result(undefined, { isLoading: true });
    rerender(<DebtorsPage />);
    expect(screen.getByLabelText('در حال دریافت بدهکاران')).toBeInTheDocument();
  });
});
