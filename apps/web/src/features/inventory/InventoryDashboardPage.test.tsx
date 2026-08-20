import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type * as ReactRouter from '@tanstack/react-router';
import { formatCoinCount, formatGram, formatRial } from '@gold/core-calc';
import type * as Queries from '@/api/queries';
import type {
  CoinTypeVersion,
  Dashboard,
  JewelryItemVersion,
  RecentInventoryMovement,
} from '@/api/contracts';
import InventoryDashboardPage from './InventoryDashboardPage';

/**
 * FE-040 — داشبورد موجودی.
 *
 * پنج query مستقل mock می‌شوند (الگوی `CoinInventoryPage.test.tsx`).
 * تمرکز روی «نمایش»‌های خودِ تسک: مصنوعات، آبشده، انواع سکه، اقلام
 * کم‌موجود، آخرین حرکات — هرکدام باید از ادغام درست منبع خودش دربیاید،
 * نه فقط رندر خام یک query.
 */

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

const useDashboardMock = vi.fn();
const useJewelryItemsMock = vi.fn();
const useInventoryBalancesMock = vi.fn();
const useCoinTypesMock = vi.fn();
const useRecentInventoryMovementsMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useDashboard: () => useDashboardMock(),
  useJewelryItems: (...args: unknown[]) => useJewelryItemsMock(...args),
  useInventoryBalances: (...args: unknown[]) => useInventoryBalancesMock(...args),
  useCoinTypes: () => useCoinTypesMock(),
  useRecentInventoryMovements: (...args: unknown[]) => useRecentInventoryMovementsMock(...args),
}));

const RATE_1000 = 100_000_000n;

function jewelryItem(overrides: Partial<JewelryItemVersion> = {}): JewelryItemVersion {
  return {
    id: 'v1',
    jewelryItemId: 'i1',
    code: 'BR-750-12',
    title: 'دستبند ۱۸ عیار',
    grossWeightMg: '12350',
    karat: 750,
    stoneWeightMg: '0',
    otherDeductionWeightMg: '0',
    wageType: 'PER_GRAM',
    wageValue: '3500000',
    validFrom: '2026-07-30T09:00:00+00:00',
    validTo: null,
    version: 1,
    active: true,
    ...overrides,
  };
}

const COIN_A: CoinTypeVersion = {
  id: 'cv-a',
  coinTypeId: 'c-a',
  code: 'BAHAR',
  title: 'تمام بهار آزادی',
  grossWeightUg: '8133000',
  karat: 900,
  validFrom: '2026-07-30T09:00:00+00:00',
  validTo: null,
  version: 1,
  active: true,
  mintType: 'CENTRAL_BANK',
  isCentralBankMinted: true,
};

function dashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    asOf: '2026-08-20T08:00:00+00:00',
    dayStartsAt: '2026-08-20T00:00:00+00:00',
    dayEndsAt: '2026-08-21T00:00:00+00:00',
    displayUnit: 'GOLD',
    currentMazneh: {
      id: 'q1',
      amountRial: '324885150',
      observedAt: '2026-08-20T08:00:00+00:00',
      goldRatePerGramRial: RATE_1000.toString(),
    },
    today: {
      sales: { raw: { rial: '0', pureGoldMg: '0' }, displayAmount: '0' },
      purchases: { raw: { rial: '0', pureGoldMg: '0' }, displayAmount: '0' },
      receipts: { raw: { rial: '0', pureGoldMg: '0' }, displayAmount: '0' },
      payments: { raw: { rial: '0', pureGoldMg: '0' }, displayAmount: '0' },
      invoiceCount: 0,
    },
    partyBalances: null,
    inventory: { meltedGoldPureMg: '5000', coins: [{ coinTypeId: 'c-a', code: 'BAHAR', count: 2 }] },
    ...overrides,
  };
}

function movement(overrides: Partial<RecentInventoryMovement> = {}): RecentInventoryMovement {
  return {
    id: 'm1',
    sourceType: 'SALE',
    itemType: 'JEWELRY',
    itemLabel: 'دستبند ۱۸ عیار',
    quantity: '-1',
    occurredAt: '2026-08-20T06:00:00+00:00',
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <InventoryDashboardPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useDashboardMock.mockReset();
  useJewelryItemsMock.mockReset();
  useInventoryBalancesMock.mockReset();
  useCoinTypesMock.mockReset();
  useRecentInventoryMovementsMock.mockReset();

  useDashboardMock.mockReturnValue({ data: dashboard(), isLoading: false, isError: false, refetch: vi.fn() });
  useJewelryItemsMock.mockReturnValue({
    data: { items: [jewelryItem({ jewelryItemId: 'i1', title: 'دستبند ۱۸ عیار' })] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  useInventoryBalancesMock.mockReturnValue({
    data: [{ itemType: 'JEWELRY', itemId: 'i1', quantity: '5' }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  useCoinTypesMock.mockReturnValue({ data: [COIN_A], isLoading: false, isError: false, refetch: vi.fn() });
  useRecentInventoryMovementsMock.mockReturnValue({
    data: [movement()],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

describe('InventoryDashboardPage — مصنوعات و انواع سکه', () => {
  it('تعداد نوع و مجموع قطعه‌ی زیورآلات را از ادغام کاتالوگ+مانده می‌سازد', () => {
    renderPage();
    expect(screen.getByText('۱ نوع · ۵ عدد')).toBeInTheDocument();
  });

  it('تعداد نوع و مجموع قطعه‌ی سکه را از dashboard.inventory.coins می‌سازد', () => {
    renderPage();
    expect(screen.getByText('۱ نوع · ۲ عدد')).toBeInTheDocument();
  });
});

describe('InventoryDashboardPage — آبشده', () => {
  it('با مظنه‌ی موجود، مبلغ دومقیاسه نمایش داده می‌شود', () => {
    renderPage();
    // ۵۰۰۰ میلی‌گرم × ۱۰۰٬۰۰۰٬۰۰۰ ÷ ۱۰۰۰ = ۵۰۰٬۰۰۰٬۰۰۰ ریال؛ پیش‌فرض واحد طلاست
    expect(screen.getByText(formatGram(5000n))).toBeInTheDocument();
  });

  it('بدون مظنه، فقط وزن خام گرم نمایش داده می‌شود', () => {
    useDashboardMock.mockReturnValue({
      data: dashboard({ currentMazneh: null }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText(`${formatGram(5000n)} گرم`)).toBeInTheDocument();
  });
});

describe('InventoryDashboardPage — اقلام کم‌موجود', () => {
  it('فقط اقلام با تعداد ≤ آستانه را نشان می‌دهد، از کم به زیاد', () => {
    useJewelryItemsMock.mockReturnValue({
      data: {
        items: [
          jewelryItem({ jewelryItemId: 'i1', title: 'زیاد‌موجود' }),
          jewelryItem({ jewelryItemId: 'i2', title: 'خیلی‌کم‌موجود' }),
        ],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useInventoryBalancesMock.mockReturnValue({
      data: [
        { itemType: 'JEWELRY', itemId: 'i1', quantity: '50' },
        { itemType: 'JEWELRY', itemId: 'i2', quantity: '1' },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText('خیلی‌کم‌موجود')).toBeInTheDocument();
    expect(screen.queryByText('زیاد‌موجود')).not.toBeInTheDocument();
  });

  it('کلیک روی «تلاش دوباره»، هر چهار منبع داده‌ی مصنوعات/سکه را دوباره می‌خواند', async () => {
    const refetchJewelry = vi.fn();
    const refetchBalances = vi.fn();
    const refetchCoinTypes = vi.fn();
    const refetchDashboard = vi.fn();
    useJewelryItemsMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: refetchJewelry });
    useInventoryBalancesMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: refetchBalances,
    });
    useCoinTypesMock.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: refetchCoinTypes });
    useDashboardMock.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: refetchDashboard });

    const user = userEvent.setup();
    renderPage();

    const retryButton = screen.getByRole('button', { name: 'تلاش دوباره' });
    await user.click(retryButton);

    expect(refetchJewelry).toHaveBeenCalledTimes(1);
    expect(refetchBalances).toHaveBeenCalledTimes(1);
    expect(refetchCoinTypes).toHaveBeenCalledTimes(1);
    expect(refetchDashboard).toHaveBeenCalledTimes(1);
  });
});

describe('InventoryDashboardPage — آخرین حرکات', () => {
  it('برچسب کالا و مقدار علامت‌دار حرکت را نشان می‌دهد', () => {
    renderPage();
    expect(screen.getByText('دستبند ۱۸ عیار')).toBeInTheDocument();
    expect(screen.getByText(`${formatCoinCount(-1)} عدد`)).toBeInTheDocument();
  });
});

describe('InventoryDashboardPage — کلید تعویض واحد', () => {
  it('روی صفحه در دسترس است', () => {
    renderPage();
    expect(screen.getByRole('radiogroup', { name: 'واحد نمایش اعداد' })).toBeInTheDocument();
  });

  it('کلیک روی «ریال»، ارزش آبشده را به مبلغ ریالی عوض می‌کند', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('radio', { name: 'ریال' }));
    expect(screen.getByText(formatRial(500_000_000n))).toBeInTheDocument();
  });
});
