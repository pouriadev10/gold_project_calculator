import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PriceFeedStatus, PriceQuote, SessionResponse } from '@/api/contracts';
import type * as PricingApi from '@/api/pricing';
import type * as Queries from '@/api/queries';
import { ApiError } from '@/api/api-error';
import { useSessionStore } from '@/stores/session-store';
import { QuoteSourceCard } from './QuoteSourceCard';

/** FE-082 — منبع فعال مظنه، وضعیت فید، fallback و عدم وابستگی فروش به فید. */

const usePriceFeedStatusMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  usePriceFeedStatus: (...args: unknown[]) => usePriceFeedStatusMock(...args),
}));

const refreshPriceFeedMock = vi.fn();
vi.mock('@/api/pricing', async (importOriginal) => ({
  ...(await importOriginal<typeof PricingApi>()),
  refreshPriceFeed: (...args: unknown[]) => refreshPriceFeedMock(...args),
}));

const MANUAL: PriceQuote = {
  id: 'c1000000-0000-4000-8000-000000000001',
  quoteType: 'MAZNEH',
  amountRial: 412_000_000n,
  source: 'MANUAL',
  observedAt: '2026-10-11T08:00:00.000Z',
  createdBy: 'c1000000-0000-4000-8000-000000000002',
  createdAt: '2026-10-11T08:00:00.000Z',
};
const FEED: PriceQuote = {
  ...MANUAL,
  id: 'c1000000-0000-4000-8000-000000000003',
  amountRial: 408_500_000n,
  source: 'FEED',
  createdBy: null,
  observedAt: '2026-10-09T08:00:00.000Z',
};

function status(overrides: Partial<PriceFeedStatus> = {}): PriceFeedStatus {
  return {
    quoteType: 'MAZNEH',
    providerConfigured: true,
    activeQuote: MANUAL,
    latestFeedQuote: FEED,
    latestManualQuote: MANUAL,
    checkedAt: '2026-10-11T09:00:00.000Z',
    ...overrides,
  };
}

function session(role: SessionResponse['role']): SessionResponse {
  return {
    accessToken: 'a',
    refreshToken: 'r',
    expiresInSeconds: 900,
    user: { id: 'u1', email: 'owner@example.com', displayName: 'کاربر' },
    tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
    role,
  };
}

function renderCard() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <QuoteSourceCard />
    </QueryClientProvider>,
  );
  return { invalidate };
}

function row(label: string): HTMLElement {
  return screen.getByText(label).parentElement as HTMLElement;
}

beforeEach(() => {
  usePriceFeedStatusMock.mockReset();
  usePriceFeedStatusMock.mockReturnValue({ data: status(), isLoading: false, isError: false, refetch: vi.fn() });
  refreshPriceFeedMock.mockReset();
  useSessionStore.setState({ session: session('MANAGER') });
});

afterEach(() => {
  useSessionStore.setState({ session: null });
});

describe('QuoteSourceCard — FE-082', () => {
  it('shows the active source as the source of the latest stored quote, plus each source’s last quote', () => {
    renderCard();

    expect(screen.getByText('منبع فعال: دستی')).toBeInTheDocument();
    expect(row('مظنه‌ی فعال (مبنای معامله‌ی بعدی)').querySelector('[data-raw="412000000"]')).not.toBeNull();
    expect(row('آخرین مظنه از فید').querySelector('[data-raw="408500000"]')).not.toBeNull();
    expect(row('آخرین مظنه‌ی دستی').querySelector('[data-raw="412000000"]')).not.toBeNull();
    expect(within(row('وضعیت فید')).getByText('پیکربندی شده')).toBeInTheDocument();
    expect(usePriceFeedStatusMock).toHaveBeenCalledWith('MAZNEH');
  });

  it('states that sales never wait on the feed', () => {
    renderCard();
    expect(screen.getByRole('note')).toHaveTextContent('به اتصال فید وابسته نیستند');
  });

  it('with no provider configured, offers only manual entry and disables the feed refresh', () => {
    usePriceFeedStatusMock.mockReturnValue({
      data: status({ providerConfigured: false, latestFeedQuote: null }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderCard();

    expect(within(row('وضعیت فید')).getByText('پیکربندی نشده — فقط ورود دستی')).toBeInTheDocument();
    expect(within(row('آخرین مظنه از فید')).getByText('هنوز مظنه‌ای از فید نیامده')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'دریافت از فید' })).toBeDisabled();
  });

  it('with no stored quote at all, asks for a manual quote', () => {
    usePriceFeedStatusMock.mockReturnValue({
      data: status({ activeQuote: null, latestFeedQuote: null, latestManualQuote: null }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderCard();

    expect(screen.queryByText(/منبع فعال:/)).not.toBeInTheDocument();
    expect(screen.getByText(/هنوز مظنه‌ای ثبت نشده — پیش از اولین فروش، دستی ثبت کنید/)).toBeInTheDocument();
  });

  it('a feed failure falls back to the last stored quote and says which one stays in force', async () => {
    const user = userEvent.setup();
    refreshPriceFeedMock.mockResolvedValue({ outcome: 'FALLBACK', failure: 'PROVIDER_TIMEOUT', quote: MANUAL });
    const { invalidate } = renderCard();

    await user.click(screen.getByRole('button', { name: 'دریافت از فید' }));

    const outcome = await screen.findByRole('status');
    await waitFor(() => expect(outcome).toHaveTextContent('منبع فید در زمان مقرر پاسخ نداد'));
    expect(outcome).toHaveTextContent('آخرین مظنه‌ی ذخیره‌شده (منبع دستی');
    expect(outcome).toHaveTextContent('همچنان مبنای فروش و خرید است');
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pricing'] }));
  });

  it('each refresh is a new attempt with its own idempotency key', async () => {
    const user = userEvent.setup();
    refreshPriceFeedMock.mockResolvedValue({ outcome: 'FEED', failure: null, quote: FEED });
    renderCard();

    await user.click(screen.getByRole('button', { name: 'دریافت از فید' }));
    expect(await screen.findByText(/مظنه‌ی تازه از فید ذخیره شد/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'دریافت از فید' }));

    await waitFor(() => expect(refreshPriceFeedMock).toHaveBeenCalledTimes(2));
    const [first, second] = refreshPriceFeedMock.mock.calls.map((call) => call[0] as string);
    expect(first).not.toBe(second);
  });

  it('UNAVAILABLE tells the user to enter the quote manually', async () => {
    const user = userEvent.setup();
    refreshPriceFeedMock.mockResolvedValue({ outcome: 'UNAVAILABLE', failure: 'PROVIDER_ERROR', quote: null });
    renderCard();

    await user.click(screen.getByRole('button', { name: 'دریافت از فید' }));
    expect(await screen.findByText(/هیچ مظنه‌ی ذخیره‌شده‌ای هم نیست؛ مظنه را با فرم پایین دستی ثبت کنید/)).toBeInTheDocument();
  });

  it('shows a server error from the refresh request', async () => {
    const user = userEvent.setup();
    refreshPriceFeedMock.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'forbidden'));
    renderCard();

    await user.click(screen.getByRole('button', { name: 'دریافت از فید' }));
    expect(await screen.findByText('اجازه انجام این عملیات را ندارید')).toBeInTheDocument();
  });

  it('a cashier sees the status but cannot trigger the feed', () => {
    useSessionStore.setState({ session: session('CASHIER') });
    renderCard();

    expect(screen.getByText('منبع فعال: دستی')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'دریافت از فید' })).not.toBeInTheDocument();
  });

  it('shows loading and a retryable error', async () => {
    usePriceFeedStatusMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <QuoteSourceCard />
      </QueryClientProvider>,
    );
    expect(screen.queryByText('منبع مظنه')).not.toBeInTheDocument();
    unmount();

    const refetch = vi.fn();
    usePriceFeedStatusMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderCard();
    await userEvent.setup().click(screen.getByRole('button', { name: /تلاش/ }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('sales do not depend on the feed connection', () => {
  /**
   * فروش، خرید، تسویه و خانه فقط شناسه‌ی آخرین مظنه‌ی **ذخیره‌شده** را
   * می‌فرستند (`quoteId`)؛ هیچ‌کدام نباید به endpoint فید وصل شوند، وگرنه قطع
   * فید ثبت معامله را متوقف می‌کرد.
   */
  it('only the pricing feature references the feed API', () => {
    const sources = import.meta.glob('/src/features/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.startsWith('/src/features/pricing/') && !/\.test\.tsx?$/u.test(path))
      .filter(([, source]) => /usePriceFeedStatus|refreshPriceFeed|pricing\/feed/u.test(String(source)))
      .map(([path]) => path);

    expect(Object.keys(sources).some((path) => path.startsWith('/src/features/sales/'))).toBe(true);
    expect(offenders).toEqual([]);
  });
});
