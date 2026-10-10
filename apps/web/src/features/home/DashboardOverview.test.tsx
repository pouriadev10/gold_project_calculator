import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { dualFromPure, dualFromRial } from '@gold/core-calc';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type * as ReactRouter from '@tanstack/react-router';
import type { Dashboard } from '@/api/contracts';
import type * as Queries from '@/api/queries';
import { UnitToggle } from '@/components/common/UnitToggle';
import { useUnitStore } from '@/stores/unit-store';
import { DashboardOverview } from './DashboardOverview';

/** FE-074 — داشبورد اصلی. `useDashboard` مستقیم mock می‌شود. */

const RATE = 4_800_000n;

const useDashboardMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useDashboard: (...args: unknown[]) => useDashboardMock(...args),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return {
    ...actual,
    Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  };
});

function rialCard(rial: bigint) {
  return {
    raw: { rial: rial.toString(), pureGoldMg: '0' },
    displayAmount: dualFromRial(rial, RATE).pureMg.toString(),
  };
}

function mixedCard(rial: bigint, pureGoldMg: bigint) {
  return {
    raw: { rial: rial.toString(), pureGoldMg: pureGoldMg.toString() },
    displayAmount: (pureGoldMg + dualFromRial(rial, RATE).pureMg).toString(),
  };
}

const SALES_RIAL = 85_000_000n;
const CREDITORS_RIAL = -2_000_000n;
const CREDITORS_GOLD = -300_000n;

function dashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    asOf: '2026-10-10T08:00:00.000Z',
    dayStartsAt: '2026-10-10T00:00:00.000Z',
    dayEndsAt: '2026-10-11T00:00:00.000Z',
    displayUnit: 'GOLD',
    currentMazneh: {
      id: 'c1000000-0000-4000-8000-000000000001',
      amountRial: '480000000',
      observedAt: '2026-10-10T07:30:00.000Z',
      goldRatePerGramRial: RATE.toString(),
    },
    today: {
      sales: rialCard(SALES_RIAL),
      purchases: rialCard(32_000_000n),
      receipts: rialCard(50_000_000n),
      payments: rialCard(12_000_000n),
      invoiceCount: 6,
    },
    partyBalances: {
      debtors: mixedCard(10_000_000n, 1_500_000n),
      creditors: mixedCard(CREDITORS_RIAL, CREDITORS_GOLD),
      coinsRemainSeparate: true,
    },
    inventory: {
      meltedGoldPureMg: '320000',
      coins: [
        { coinTypeId: 'c3000000-0000-4000-8000-000000000001', code: 'BAHAR', count: 12 },
        { coinTypeId: 'c3000000-0000-4000-8000-000000000002', code: 'NIM', count: 5 },
      ],
    },
    ...overrides,
  };
}

function result(data: Dashboard | undefined, overrides: Record<string, unknown> = {}) {
  return { data, isLoading: false, isError: false, refetch: vi.fn(), ...overrides };
}

function tile(label: string): HTMLElement {
  return screen.getByText(label).parentElement!;
}

beforeEach(() => {
  useUnitStore.setState({ unit: 'gold' });
  useDashboardMock.mockReset();
  useDashboardMock.mockReturnValue(result(dashboard()));
});

describe('DashboardOverview — FE-074', () => {
  it('shows every card of the task', () => {
    render(<DashboardOverview />);

    for (const label of [
      'فروش امروز',
      'خرید امروز',
      'دریافت امروز',
      'پرداخت امروز',
      'تعداد فاکتور امروز',
      'بدهکاران',
      'بستانکاران',
      'موجودی آبشده',
      'موجودی سکه',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(within(tile('تعداد فاکتور امروز')).getByText('۶')).toBeInTheDocument();
    expect(screen.getByText(/معادل طلا\/ریال با مظنه جاری/)).toBeInTheDocument();
    expect(useDashboardMock).toHaveBeenCalledWith('GOLD');
  });

  it('switches every financial card with the unit toggle without a new request', async () => {
    const user = userEvent.setup();
    render(
      <>
        <UnitToggle />
        <DashboardOverview />
      </>,
    );

    const salesGold = dualFromRial(SALES_RIAL, RATE).pureMg;
    expect(tile('فروش امروز').querySelector(`[data-raw="${salesGold}"][data-unit="gold"]`)).not.toBeNull();
    expect(tile('موجودی آبشده').querySelector('[data-raw="320000"][data-unit="gold"]')).not.toBeNull();

    await user.click(screen.getByRole('radio', { name: /ریال/ }));

    expect(tile('فروش امروز').querySelector(`[data-raw="${SALES_RIAL}"][data-unit="rial"]`)).not.toBeNull();
    expect(
      tile('موجودی آبشده').querySelector(`[data-raw="${dualFromPure(320_000n, RATE).rial}"][data-unit="rial"]`),
    ).not.toBeNull();
    for (const label of ['خرید امروز', 'دریافت امروز', 'پرداخت امروز', 'بدهکاران', 'بستانکاران']) {
      expect(tile(label).querySelector('[data-unit="rial"]')).not.toBeNull();
      expect(tile(label).querySelector('[data-unit="gold"]')).toBeNull();
    }
    expect(useDashboardMock.mock.calls.every((call) => call[0] === 'GOLD')).toBe(true);
  });

  it('shows creditors as a magnitude with a direction label, linked to their lists', () => {
    render(<DashboardOverview />);

    const creditors = tile('بستانکاران');
    const expected = -(CREDITORS_GOLD + dualFromRial(CREDITORS_RIAL, RATE).pureMg);
    expect(creditors.querySelector(`[data-raw="${expected}"][data-unit="gold"]`)).not.toBeNull();
    expect(creditors).not.toHaveTextContent('−');
    expect(within(creditors).getByText('بدهی فروشگاه به اشخاص')).toBeInTheDocument();
    expect(within(creditors).getByRole('link', { name: /مشاهده فهرست/ })).toHaveAttribute('href', '/reporting/creditors');
    expect(within(tile('بدهکاران')).getByText('طلب فروشگاه از اشخاص')).toBeInTheDocument();
    expect(within(tile('بدهکاران')).getByRole('link', { name: /مشاهده فهرست/ })).toHaveAttribute(
      'href',
      '/reporting/debtors',
    );
  });

  it('keeps each coin type as a separate count and never shows silver or bullion', () => {
    render(<DashboardOverview />);

    const coins = within(screen.getByRole('list', { name: 'موجودی انواع سکه' })).getAllByRole('listitem');
    expect(coins).toHaveLength(2);
    expect(coins[0]).toHaveTextContent('BAHAR');
    expect(coins[0]).toHaveTextContent('۱۲');
    expect(coins[1]).toHaveTextContent('NIM');
    expect(screen.queryByText(/نقره|شمش/)).not.toBeInTheDocument();
  });

  it('without a current mazneh shows raw rial flows and refuses to net party balances', async () => {
    const user = userEvent.setup();
    useDashboardMock.mockReturnValue(
      result(
        dashboard({
          currentMazneh: null,
          today: {
            sales: { raw: { rial: SALES_RIAL.toString(), pureGoldMg: '0' }, displayAmount: null },
            purchases: { raw: { rial: '0', pureGoldMg: '0' }, displayAmount: null },
            receipts: { raw: { rial: '0', pureGoldMg: '0' }, displayAmount: null },
            payments: { raw: { rial: '0', pureGoldMg: '0' }, displayAmount: null },
            invoiceCount: 1,
          },
          partyBalances: null,
        }),
      ),
    );
    render(
      <>
        <UnitToggle />
        <DashboardOverview />
      </>,
    );

    expect(tile('فروش امروز').querySelector(`[data-raw="${SALES_RIAL}"][data-unit="rial"]`)).not.toBeNull();
    expect(screen.getByText(/جمع بدهکاران و بستانکاران قابل محاسبه نیست/)).toBeInTheDocument();
    expect(screen.queryByText('بدهکاران')).not.toBeInTheDocument();
    expect(screen.getByText('هنوز مظنه‌ای ثبت نشده است؛ معادل طلا/ریال در دسترس نیست.')).toBeInTheDocument();

    // بدون مظنه هیچ معادل ساختگی‌ای با کلید واحد ساخته نمی‌شود.
    await user.click(screen.getByRole('radio', { name: /ریال/ }));
    await user.click(screen.getByRole('radio', { name: /طلا/ }));
    expect(tile('فروش امروز').querySelector('[data-unit="gold"]')).toBeNull();
    expect(tile('موجودی آبشده').querySelector('[data-raw="320000"][data-unit="gold"]')).not.toBeNull();
  });

  it('keeps a stable skeleton while loading and offers retry on error', async () => {
    useDashboardMock.mockReturnValue(result(undefined, { isLoading: true }));
    const { rerender } = render(<DashboardOverview />);
    const skeleton = screen.getByLabelText('در حال دریافت داشبورد');
    // همان تعداد کاشی‌های محتوا: ۵ امروز + ۲ مانده + ۲ موجودی.
    expect(skeleton.querySelectorAll('.min-h-\\[5\\.5rem\\]')).toHaveLength(9);

    const refetch = vi.fn();
    useDashboardMock.mockReturnValue(result(undefined, { isError: true, refetch }));
    rerender(<DashboardOverview />);
    await userEvent.setup().click(screen.getByRole('button', { name: /تلاش/ }));
    expect(refetch).toHaveBeenCalled();
  });
});
