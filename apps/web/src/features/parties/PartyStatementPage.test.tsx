import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_PAGE_SIZE } from '@gold/contracts';
import { dualFromPure, gramRate1000 } from '@gold/core-calc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type * as ReactRouter from '@tanstack/react-router';
import type { PartyStatement, PartyStatementQuery, SessionResponse } from '@/api/contracts';
import type * as Queries from '@/api/queries';
import { useSessionStore } from '@/stores/session-store';
import { useUnitStore } from '@/stores/unit-store';
import PartyStatementPage from './PartyStatementPage';

/**
 * FE-070 — صورت‌حساب کامل شخص.
 *
 * `useParty` و `usePartyStatement` مستقیم mock می‌شوند. صفحه دو بار
 * `usePartyStatement` را صدا می‌زند: یک صفحه‌ی بزرگ بدون فیلتر برای
 * گزینه‌های بُعد (`limit = MAX_PAGE_SIZE`) و خود نتایج فیلترشده.
 */
const PARTY_ID = 'a1000000-0000-4000-8000-000000000001';
const MAZNEH = 480_000_000n;
const RATE_1000 = gramRate1000(MAZNEH);

const useQueryMocks = {
  useParty: vi.fn(),
  usePartyStatement: vi.fn(),
};
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useParty: (...args: unknown[]) => useQueryMocks.useParty(...args),
  usePartyStatement: (...args: unknown[]) => useQueryMocks.usePartyStatement(...args),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return {
    ...actual,
    useParams: () => ({ partyId: PARTY_ID }),
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
      <a
        href={to
          .replace('$partyId', params?.['partyId'] ?? '')
          .replace('$invoiceId', params?.['invoiceId'] ?? '')}
        {...rest}
      >
        {children}
      </a>
    ),
  };
});

const GOLD = {
  id: 'd2000000-0000-4000-8000-000000000001',
  code: 'GOLD-1000',
  kind: 'GOLD' as const,
  coinTypeId: null,
  coinCode: null,
};
const RIAL = {
  id: 'd2000000-0000-4000-8000-000000000002',
  code: 'RIAL',
  kind: 'RIAL' as const,
  coinTypeId: null,
  coinCode: null,
};
const COIN = {
  id: 'd2000000-0000-4000-8000-000000000003',
  code: 'COIN-BAHAR',
  kind: 'COIN' as const,
  coinTypeId: 'c3000000-0000-4000-8000-000000000001',
  coinCode: 'BAHAR',
};

const SALE_ID = 'f1000000-0000-4000-8000-000000000001';

const ITEMS: PartyStatement['items'] = [
  {
    ledgerTransactionId: 'e1000000-0000-4000-8000-000000000001',
    source: { type: 'SALES_INVOICE', id: SALE_ID },
    effectiveAt: '2026-09-01T08:00:00.000Z',
    description: 'Cash jewelry sale',
    dimension: GOLD,
    quantity: '2500',
    runningBalance: '10000',
    documentRateSnapshots: [
      {
        quoteId: 'c1000000-0000-4000-8000-000000000001',
        quoteAmountRial: MAZNEH.toString(),
        quoteObservedAt: '2026-09-01T07:55:00.000Z',
        pricingSnapshot: { totals: {}, settings: { baseQuoteKarat: '705', mithqalGrams: '4.6083' } },
      },
    ],
  },
  {
    ledgerTransactionId: 'e1000000-0000-4000-8000-000000000002',
    source: { type: 'OPENING_BALANCE', id: 'f1000000-0000-4000-8000-000000000002' },
    effectiveAt: '2026-09-02T08:00:00.000Z',
    description: 'Opening balance',
    dimension: RIAL,
    quantity: '-12000000',
    runningBalance: '-12000000',
    documentRateSnapshots: [],
  },
  {
    ledgerTransactionId: 'e1000000-0000-4000-8000-000000000003',
    source: { type: 'SETTLEMENT', id: 'f1000000-0000-4000-8000-000000000003' },
    effectiveAt: '2026-09-03T08:00:00.000Z',
    description: 'Coin settlement',
    dimension: COIN,
    quantity: '2',
    runningBalance: '3',
    documentRateSnapshots: [],
  },
];

function statement(
  items: PartyStatement['items'] = ITEMS,
  page: Partial<Pick<PartyStatement, 'total' | 'limit' | 'offset' | 'partyId'>> = {},
): PartyStatement {
  return {
    items,
    total: items.length,
    limit: 20,
    offset: 0,
    partyId: PARTY_ID,
    displayReferenceMazneh: null,
    ...page,
  };
}

function result(data: PartyStatement | undefined, overrides: Record<string, unknown> = {}) {
  return {
    data,
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

let resultsResponse: ReturnType<typeof result>;

function resultQueries(): PartyStatementQuery[] {
  return useQueryMocks.usePartyStatement.mock.calls
    .map((call) => call[1] as PartyStatementQuery)
    .filter((query) => query.limit !== MAX_PAGE_SIZE);
}

function lastResultQuery(): PartyStatementQuery | undefined {
  return resultQueries().at(-1);
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

beforeEach(() => {
  useUnitStore.setState({ unit: 'gold' });
  resultsResponse = result(statement());
  useQueryMocks.useParty.mockReset();
  useQueryMocks.useParty.mockReturnValue(
    result(undefined, {
      data: { id: PARTY_ID, displayName: 'حسین مرادی' },
    }),
  );
  useQueryMocks.usePartyStatement.mockReset();
  useQueryMocks.usePartyStatement.mockImplementation((_id: string, query: PartyStatementQuery) =>
    query.limit === MAX_PAGE_SIZE ? result(statement(ITEMS, { limit: MAX_PAGE_SIZE })) : resultsResponse,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  useSessionStore.setState({ session: null });
});

describe('PartyStatementPage — FE-070', () => {
  it('shows the party title, the global unit toggle and the initial server query', () => {
    render(<PartyStatementPage />);

    expect(screen.getByRole('heading', { name: 'صورت‌حساب حسین مرادی' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'واحد نمایش اعداد' })).toBeInTheDocument();
    expect(lastResultQuery()).toEqual({ limit: 20, offset: 0 });
    expect(useQueryMocks.usePartyStatement).toHaveBeenCalledWith(PARTY_ID, {
      limit: MAX_PAGE_SIZE,
      offset: 0,
    });
    expect(screen.getByRole('link', { name: /بازگشت به جزئیات شخص/ })).toHaveAttribute(
      'href',
      `/parties/${PARTY_ID}`,
    );
  });

  it('renders one card per event on mobile with type, date, effect, balance and document number', () => {
    render(<PartyStatementPage />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(3);

    const sale = within(cards[0]!);
    expect(sale.getByText('فاکتور فروش')).toBeInTheDocument();
    expect(sale.getByText('تاریخ')).toBeInTheDocument();
    expect(sale.getByText('اثر')).toBeInTheDocument();
    expect(sale.getByText('مانده')).toBeInTheDocument();
    expect(sale.getByText('شماره سند')).toBeInTheDocument();
    expect(sale.getByText('بدهکار')).toBeInTheDocument();
    expect(sale.getByRole('link', { name: 'مشاهده فاکتور f1000000' })).toHaveAttribute(
      'href',
      `/sales/invoices/${SALE_ID}`,
    );

    const opening = within(cards[1]!);
    expect(opening.getByText('مانده افتتاحیه')).toBeInTheDocument();
    expect(opening.getByText('بستانکار')).toBeInTheDocument();
  });

  it('keeps the raw unit of every dimension and never converts coins', () => {
    render(<PartyStatementPage />);
    const cards = screen.getAllByRole('listitem');

    expect(cards[0]!.querySelector('[data-raw="2500"][data-unit="gold"]')).not.toBeNull();
    expect(cards[0]!.querySelector('[data-raw="10000"][data-unit="gold"]')).not.toBeNull();
    expect(cards[1]!.querySelector('[data-raw="-12000000"][data-unit="rial"]')).not.toBeNull();

    const coin = within(cards[2]!);
    expect(coin.getByText('سکه BAHAR')).toBeInTheDocument();
    expect(coin.getAllByText('عدد')).toHaveLength(2);
    expect(cards[2]!.querySelector('[data-unit]')).toBeNull();
    expect(coin.queryByText(/معادل/)).not.toBeInTheDocument();
  });

  it('converts with the document’s locked rate when the unit toggles, and never invents one', async () => {
    const user = userEvent.setup();
    render(<PartyStatementPage />);

    // حالت طلا: ردیف طلایی معادل لازم ندارد؛ ردیف ریالی بدون snapshot عدد حدسی نمی‌سازد.
    const goldCards = screen.getAllByRole('listitem');
    expect(within(goldCards[0]!).queryByText(/معادل/)).not.toBeInTheDocument();
    expect(within(goldCards[1]!).getAllByText('معادل: نرخ سند ثبت نشده')).toHaveLength(2);

    await user.click(screen.getByRole('radio', { name: /ریال/ }));

    const cards = screen.getAllByRole('listitem');
    const expectedEffect = dualFromPure(2500n, RATE_1000).rial;
    const expectedBalance = dualFromPure(10000n, RATE_1000).rial;
    expect(cards[0]!.querySelector(`[data-raw="${expectedEffect}"][data-unit="rial"]`)).not.toBeNull();
    expect(cards[0]!.querySelector(`[data-raw="${expectedBalance}"][data-unit="rial"]`)).not.toBeNull();

    // مانده افتتاحیه ریالی است؛ در حالت ریال معادلی لازم ندارد.
    expect(within(cards[1]!).queryByText(/معادل/)).not.toBeInTheDocument();
  });

  it('renders a table with the locked mazneh column on desktop', () => {
    stubViewport(true);
    render(<PartyStatementPage />);

    const table = screen.getByRole('table');
    expect(within(table).getByText('نرخ سند')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(table.querySelector(`[data-raw="${MAZNEH}"]`)).not.toBeNull();
    expect(within(table).getAllByText('بدون نرخ سند')).toHaveLength(2);
  });

  it('sends source type and dimension filters to the server and resets the page', async () => {
    const user = userEvent.setup();
    resultsResponse = result(statement(ITEMS, { total: 45, offset: 0 }));
    render(<PartyStatementPage />);

    await user.click(screen.getByRole('button', { name: /بعدی/ }));
    expect(lastResultQuery()).toEqual({ limit: 20, offset: 20 });

    await user.selectOptions(screen.getByLabelText('نوع سند'), 'SETTLEMENT');
    expect(lastResultQuery()).toEqual({ limit: 20, offset: 0, sourceType: 'SETTLEMENT' });

    const dimensionSelect = screen.getByLabelText('بُعد');
    expect(within(dimensionSelect).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'همه‌ی بُعدها',
      'طلای خالص',
      'ریال',
      'سکه BAHAR',
    ]);
    await user.selectOptions(dimensionSelect, COIN.id);
    expect(lastResultQuery()).toEqual({
      limit: 20,
      offset: 0,
      sourceType: 'SETTLEMENT',
      dimensionId: COIN.id,
    });

    await user.click(screen.getByRole('button', { name: /پاک‌کردن فیلترها/ }));
    expect(lastResultQuery()).toEqual({ limit: 20, offset: 0 });
  });

  it('sends the Jalali range as tenant-timezone ISO bounds and blocks an inverted range', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T08:00:00.000Z')); // ۲۰ مهر ۱۴۰۵
    useSessionStore.setState({
      session: {
        accessToken: 'a',
        refreshToken: 'r',
        expiresInSeconds: 900,
        user: { id: 'u1', email: 'owner@example.com', displayName: 'مالک' },
        tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
        role: 'OWNER',
      } satisfies SessionResponse,
    });
    const user = userEvent.setup();
    render(<PartyStatementPage />);

    await user.click(screen.getByRole('button', { name: 'امروز' }));
    expect(lastResultQuery()).toEqual({
      limit: 20,
      offset: 0,
      from: '2026-10-11T20:30:00.000Z',
      to: '2026-10-12T20:29:59.999Z',
    });

    await user.click(screen.getByRole('button', { name: /تا تاریخ/ }));
    const callsBefore = resultQueries().length;
    await user.click(screen.getByRole('button', { name: '۱ مهر ۱۴۰۵' }));
    expect(screen.getByRole('alert')).toHaveTextContent('تاریخ پایان نمی‌تواند پیش از تاریخ شروع باشد.');
    expect(resultQueries()).toHaveLength(callsBefore);
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('paginates with page indicator and disables navigation while the next page loads', () => {
    resultsResponse = result(statement(ITEMS, { total: 45, offset: 20 }), { isPlaceholderData: true });
    const { rerender } = render(<PartyStatementPage />);

    expect(screen.getByText('صفحه ۲ از ۳')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /قبلی/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /بعدی/ })).toBeDisabled();

    resultsResponse = result(statement(ITEMS, { total: 45, offset: 20 }));
    rerender(<PartyStatementPage />);
    expect(screen.getByRole('button', { name: /قبلی/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /بعدی/ })).toBeEnabled();
  });

  it('shows empty, error and foreign-party states', async () => {
    const user = userEvent.setup();
    resultsResponse = result(statement([]));
    const { rerender } = render(<PartyStatementPage />);
    expect(screen.getByText('رویدادی پیدا نشد')).toBeInTheDocument();

    const refetch = vi.fn();
    resultsResponse = result(undefined, { isError: true, refetch });
    rerender(<PartyStatementPage />);
    expect(screen.getByText('دریافت صورت‌حساب ناموفق بود.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /تلاش/ }));
    expect(refetch).toHaveBeenCalled();

    resultsResponse = result(statement(ITEMS, { partyId: 'a1000000-0000-4000-8000-000000000099' }));
    rerender(<PartyStatementPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('پاسخ صورت‌حساب به این شخص تعلق ندارد.');
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();

    resultsResponse = result(undefined, { isLoading: true });
    rerender(<PartyStatementPage />);
    expect(screen.getByLabelText('در حال دریافت صورت‌حساب')).toBeInTheDocument();
  });
});
