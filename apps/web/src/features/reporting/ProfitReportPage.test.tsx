import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LedgerProfitReport, LedgerProfitReportQuery, SessionResponse } from '@/api/contracts';
import type * as Queries from '@/api/queries';
import { useSessionStore } from '@/stores/session-store';
import { useUnitStore } from '@/stores/unit-store';
import ProfitReportPage from './ProfitReportPage';

/**
 * FE-075 — گزارش سود. `useLedgerProfitReport` مستقیم mock می‌شود.
 *
 * عمداً چهره‌ی طلایی هر سنجه طوری انتخاب شده که با هیچ نرخ واحدی از
 * چهره‌ی ریالی به دست نمی‌آید (مثل واقعیت: هر رویداد با مظنه‌ی خودش
 * تبدیل شده)، تا ثابت شود صفحه فقط چهره‌ی سرور را انتخاب می‌کند.
 */

const useLedgerProfitReportMock = vi.fn();
const useLedgerProfitTrendMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useLedgerProfitReport: (...args: unknown[]) => useLedgerProfitReportMock(...args),
  // روند (FE-076) در تست جدای خودش پوشش داده شده؛ این‌جا فقط در حال بارگذاری.
  useLedgerProfitTrend: (...args: unknown[]) => useLedgerProfitTrendMock(...args),
}));

/** دوشنبه ۲۰ مهر ۱۴۰۵، تهران. */
const NOW = new Date('2026-10-12T08:00:00.000Z');

const SESSION: SessionResponse = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'owner@example.com', displayName: 'مالک' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
  role: 'OWNER',
};

function report(overrides: Partial<LedgerProfitReport> = {}): LedgerProfitReport {
  return {
    from: '2026-09-22T20:30:00.000Z',
    to: '2026-10-22T20:30:00.000Z',
    revenue: { rial: '850000000', goldEquivalentMg: '177300' },
    costOfGoods: { rial: '700000000', goldEquivalentMg: '146100' },
    grossProfit: { rial: '150000000', goldEquivalentMg: '31200' },
    operatingProfit: { rial: '135000000', goldEquivalentMg: '28050' },
    goldPriceEffect: { rial: '-8000000', goldEquivalentMg: '-1660' },
    coinBubbleEffect: { rial: '15000000', goldEquivalentMg: '3150' },
    totalProfit: { rial: '142000000', goldEquivalentMg: '29540' },
    ...overrides,
  };
}

function result(data: LedgerProfitReport | undefined, overrides: Record<string, unknown> = {}) {
  return { data, isLoading: false, isError: false, isPlaceholderData: false, refetch: vi.fn(), ...overrides };
}

function lastQuery(): LedgerProfitReportQuery | undefined {
  return useLedgerProfitReportMock.mock.calls.at(-1)?.[0] as LedgerProfitReportQuery | undefined;
}

function row(key: string): HTMLElement {
  return document.querySelector(`[data-measure="${key}"]`) as HTMLElement;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  useSessionStore.setState({ session: SESSION });
  useUnitStore.setState({ unit: 'gold' });
  useLedgerProfitReportMock.mockReset();
  useLedgerProfitReportMock.mockReturnValue(result(report()));
  useLedgerProfitTrendMock.mockReset();
  useLedgerProfitTrendMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
});

afterEach(() => {
  vi.useRealTimers();
  useSessionStore.setState({ session: null });
});

describe('ProfitReportPage — FE-075', () => {
  it('defaults to this Jalali month, sent half-open in the tenant timezone', () => {
    render(<ProfitReportPage />);

    expect(screen.getByRole('heading', { name: 'گزارش سود' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'واحد نمایش اعداد' })).toBeInTheDocument();
    // ۱ تا ۳۰ مهر ۱۴۰۵ در تهران؛ `to` نیمه‌شب ۱ آبان است چون سرور `lt` می‌خواند.
    expect(lastQuery()).toEqual({ from: '2026-09-22T20:30:00.000Z', to: '2026-10-22T20:30:00.000Z' });
    expect(screen.getByText('بازه: ۱ مهر ۱۴۰۵ تا ۳۰ مهر ۱۴۰۵')).toBeInTheDocument();
  });

  it('shows the full backend breakdown in order, with how each subtotal is formed', () => {
    render(<ProfitReportPage />);

    const labels = within(screen.getByRole('list', { name: 'ریز سود' }))
      .getAllByRole('listitem')
      .map((item) => item.querySelector('p')?.textContent);
    expect(labels).toEqual([
      'درآمد',
      'بهای تمام‌شده',
      'سود ناخالص',
      'اثر حباب سکه',
      'سود عملیاتی',
      'اثر نوسان طلا',
      'سود کل',
    ]);
    expect(within(row('grossProfit')).getByText('درآمد منهای بهای تمام‌شده.')).toBeInTheDocument();
    expect(within(row('totalProfit')).getByText('سود ناخالص به‌علاوه‌ی اثر نوسان طلا.')).toBeInTheDocument();
    expect(within(row('coinBubbleEffect')).getByText(/فقط سکه‌های ضرب بانک مرکزی حباب دارند/)).toBeInTheDocument();
  });

  it('the unit toggle only picks the server face — never a conversion at today’s rate', async () => {
    const user = userEvent.setup();
    render(<ProfitReportPage />);

    expect(row('revenue').querySelector('[data-raw="177300"][data-unit="gold"]')).not.toBeNull();
    // چهره‌ی دیگر هم دیده می‌شود.
    expect(row('revenue').querySelector('[data-raw="850000000"][data-unit="rial"]')).not.toBeNull();

    await user.click(screen.getByRole('radio', { name: /ریال/ }));

    expect(row('revenue').querySelector('span[data-raw="850000000"][data-unit="rial"] bdi.text-base')).not.toBeNull();
    expect(row('totalProfit').querySelector('[data-raw="142000000"][data-unit="rial"]')).not.toBeNull();
    expect(row('totalProfit').querySelector('[data-raw="29540"][data-unit="gold"]')).not.toBeNull();
    // تعویض واحد درخواست تازه نمی‌سازد.
    expect(new Set(useLedgerProfitReportMock.mock.calls.map((call) => JSON.stringify(call[0]))).size).toBe(1);
  });

  it('labels profit and effects by sign', () => {
    useLedgerProfitReportMock.mockReturnValue(
      result(report({ totalProfit: { rial: '-5000000', goldEquivalentMg: '-1040' } })),
    );
    render(<ProfitReportPage />);

    expect(within(row('goldPriceEffect')).getByText('اثر منفی')).toBeInTheDocument();
    expect(within(row('coinBubbleEffect')).getByText('اثر مثبت')).toBeInTheDocument();
    expect(within(row('grossProfit')).getByText('سود')).toBeInTheDocument();
    expect(within(row('totalProfit')).getByText('زیان')).toBeInTheDocument();
    expect(within(row('revenue')).queryByText(/سود|زیان|اثر/)).toBeNull();
  });

  it('clearing the range asks for the whole period; an inverted range sends nothing', async () => {
    const user = userEvent.setup();
    render(<ProfitReportPage />);

    await user.click(screen.getByRole('button', { name: /پاک کردن تاریخ/ }));
    expect(lastQuery()).toEqual({});
    expect(screen.getByText('بازه: کل دوره')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'امروز' }));
    expect(lastQuery()).toEqual({ from: '2026-10-11T20:30:00.000Z', to: '2026-10-12T20:30:00.000Z' });

    await user.click(screen.getByRole('button', { name: /تا تاریخ/ }));
    const calls = useLedgerProfitReportMock.mock.calls.length;
    await user.click(screen.getByRole('button', { name: '۱ مهر ۱۴۰۵' }));
    expect(screen.getByRole('alert')).toHaveTextContent('تاریخ پایان نمی‌تواند پیش از تاریخ شروع باشد.');
    expect(useLedgerProfitReportMock).toHaveBeenCalledTimes(calls);
    expect(screen.queryByRole('list', { name: 'ریز سود' })).not.toBeInTheDocument();
  });

  it('shows empty, error and loading states', async () => {
    const zero = { rial: '0', goldEquivalentMg: '0' };
    useLedgerProfitReportMock.mockReturnValue(
      result(
        report({
          revenue: zero,
          costOfGoods: zero,
          grossProfit: zero,
          operatingProfit: zero,
          goldPriceEffect: zero,
          coinBubbleEffect: zero,
          totalProfit: zero,
        }),
      ),
    );
    const { rerender } = render(<ProfitReportPage />);
    expect(screen.getByText('سودی در این بازه ثبت نشده')).toBeInTheDocument();

    const refetch = vi.fn();
    useLedgerProfitReportMock.mockReturnValue(result(undefined, { isError: true, refetch }));
    rerender(<ProfitReportPage />);
    await userEvent.setup().click(screen.getByRole('button', { name: /تلاش/ }));
    expect(refetch).toHaveBeenCalled();

    useLedgerProfitReportMock.mockReturnValue(result(undefined, { isLoading: true }));
    rerender(<ProfitReportPage />);
    expect(screen.getByLabelText('در حال دریافت گزارش سود')).toBeInTheDocument();
  });
});
