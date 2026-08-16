import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReactRouter from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { Party } from '@/api/contracts';
import { PartyList } from './PartyList';

/**
 * FE-032 — فهرست اشخاص.
 *
 * `useParties` مستقیم mock می‌شود (الگوی `QuoteHistoryList.test.tsx` برای
 * `usePriceQuoteHistory`) — این تست فقط رفتار خودِ لیست را می‌سنجد.
 * `Link` واقعی به یک `RouterProvider` نیاز دارد؛ اینجا مثل
 * `LoginPage.test.tsx` (که `useNavigate` را همین‌طور جایگزین می‌کند) با
 * یک anchor ساده جایگزین می‌شود، چون خودِ ماشین مسیریابی جای دیگری
 * آزموده می‌شود.
 */
const usePartiesMock = vi.fn();
vi.mock('@/api/queries', () => ({
  useParties: (...args: unknown[]) => usePartiesMock(...args),
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
      <a href={`${to}/${params?.['partyId'] ?? ''}`} {...rest}>
        {children}
      </a>
    ),
  };
});

function party(overrides: Partial<Party> = {}): Party {
  return {
    id: 'p1',
    type: 'CONSUMER',
    displayName: 'حسین مرادی',
    mobile: '09121234567',
    nationalId: null,
    linkedTenantId: null,
    status: 'ACTIVE',
    notes: null,
    createdAt: '2026-08-10T08:00:00Z',
    updatedAt: '2026-08-10T08:00:00Z',
    ...overrides,
  };
}

function page(items: Party[], total = items.length, limit = 10, offset = 0) {
  return { items, total, limit, offset };
}

const baseQuery = { limit: 10, offset: 0 };

function mockViewport(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('640px') && desktop,
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
  usePartiesMock.mockReset();
  mockViewport(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PartyList — بارگذاری، خطا، خالی', () => {
  it('در حال بارگذاری: اسکلت نشان می‌دهد', () => {
    usePartiesMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    const { container } = render(<PartyList query={baseQuery} onOffsetChange={vi.fn()} />);
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });

  it('شکست دریافت: پیام خطا و دکمه‌ی تلاش دوباره', async () => {
    const refetch = vi.fn();
    usePartiesMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    const user = userEvent.setup();
    render(<PartyList query={baseQuery} onOffsetChange={vi.fn()} />);

    expect(screen.getByText('دریافت فهرست اشخاص ناموفق بود.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'تلاش دوباره' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('فهرست خالی: پیام «شخصی پیدا نشد» را نشان می‌دهد', () => {
    usePartiesMock.mockReturnValue({ data: page([]), isLoading: false, isError: false, refetch: vi.fn() });
    render(<PartyList query={baseQuery} onOffsetChange={vi.fn()} />);
    expect(screen.getByText('شخصی پیدا نشد')).toBeInTheDocument();
  });
});

describe('PartyList — نمای دسکتاپ (از ۶۴۰px به بالا)', () => {
  it('جدول با ستون‌های نام/موبایل/نوع/وضعیت رندر می‌شود و شخص غیرفعال برچسب می‌گیرد', () => {
    mockViewport(true);
    usePartiesMock.mockReturnValue({
      data: page([
        party({ id: 'p1', displayName: 'حسین مرادی', type: 'CONSUMER', status: 'ACTIVE' }),
        party({ id: 'p2', displayName: 'مهدی صادقی', type: 'BUSINESS', status: 'INACTIVE', mobile: null }),
      ]),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<PartyList query={baseQuery} onOffsetChange={vi.fn()} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'نام' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'موبایل' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'حسین مرادی' })).toBeInTheDocument();
    expect(screen.getByText('همکار')).toBeInTheDocument();
    expect(screen.getByText('غیرفعال')).toBeInTheDocument();
    // شخص فعال برچسب وضعیت نمی‌گیرد — نویز اضافی برای حالت پیش‌فرض نیست
    expect(screen.getAllByText('غیرفعال')).toHaveLength(1);
  });
});

describe('PartyList — نمای موبایل (زیر ۶۴۰px، تمام است وقتی: بدون جدول)', () => {
  it('به‌جای جدول، فهرست کارتی کلیک‌پذیر رندر می‌شود', () => {
    mockViewport(false);
    usePartiesMock.mockReturnValue({
      data: page([party({ id: 'p1', displayName: 'حسین مرادی' })]),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<PartyList query={baseQuery} onOffsetChange={vi.fn()} />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /حسین مرادی/ })).toHaveAttribute('href', '/parties/$partyId/p1');
  });
});

describe('PartyList — pagination سرور-محور', () => {
  it('با یک صفحه، کنترل صفحه‌بندی نشان داده نمی‌شود', () => {
    usePartiesMock.mockReturnValue({
      data: page([party()], 1, 10, 0),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<PartyList query={baseQuery} onOffsetChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /بعدی/ })).not.toBeInTheDocument();
  });

  it('صفحه‌ی اول: «قبلی» غیرفعال، «بعدی» فعال است و offset درست بعدی را می‌فرستد', async () => {
    const onOffsetChange = vi.fn();
    usePartiesMock.mockReturnValue({
      data: page(Array.from({ length: 10 }, (_, i) => party({ id: `p${i}` })), 14, 10, 0),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    render(<PartyList query={{ ...baseQuery, offset: 0 }} onOffsetChange={onOffsetChange} />);

    expect(screen.getByText('صفحه ۱ از ۲')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /قبلی/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /بعدی/ }));
    expect(onOffsetChange).toHaveBeenCalledWith(10);
  });

  it('صفحه‌ی آخر: «بعدی» غیرفعال است', () => {
    usePartiesMock.mockReturnValue({
      data: page(Array.from({ length: 4 }, (_, i) => party({ id: `p${i}` })), 14, 10, 10),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(<PartyList query={{ ...baseQuery, offset: 10 }} onOffsetChange={vi.fn()} />);

    expect(screen.getByText('صفحه ۲ از ۲')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /بعدی/ })).toBeDisabled();
  });
});
