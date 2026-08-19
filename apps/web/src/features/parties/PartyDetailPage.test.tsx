import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReactRouter from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ApiError } from '@/api/api-error';
import type { Party, PartyBalances, PartyStatement } from '@/api/contracts';
import type * as PartiesApi from '@/api/parties';
import type * as Queries from '@/api/queries';
import PartyDetailPage from './PartyDetailPage';

/**
 * FE-034 — صفحه‌ی جزئیات شخص.
 *
 * چهار hook (`useParty`, `usePartyBalances`, `usePartyStatement`,
 * `useLatestPriceQuote`) و `deactivateParty` مستقیم mock می‌شوند — همان
 * الگوی `PartyList.test.tsx`/`PartyFormDialog.test.tsx`. `PartyFormDialog`
 * واقعی رندر می‌شود (نه mock) چون تست خودش را جدا دارد؛ اینجا فقط سیم‌کشی
 * «ویرایش» به آن سنجیده می‌شود، نه اعتبارسنجی داخلی‌اش.
 */
const TEST_PARTY_ID = 'a1000000-0000-4000-8000-000000000001';

const useQueryMocks = {
  useParty: vi.fn(),
  usePartyBalances: vi.fn(),
  usePartyStatement: vi.fn(),
  useLatestPriceQuote: vi.fn(),
};
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useParty: (...args: unknown[]) => useQueryMocks.useParty(...args),
  usePartyBalances: (...args: unknown[]) => useQueryMocks.usePartyBalances(...args),
  usePartyStatement: (...args: unknown[]) => useQueryMocks.usePartyStatement(...args),
  useLatestPriceQuote: (...args: unknown[]) => useQueryMocks.useLatestPriceQuote(...args),
}));

const deactivatePartyMock = vi.fn();
vi.mock('@/api/parties', async (importOriginal) => ({
  ...(await importOriginal<typeof PartiesApi>()),
  deactivateParty: (...args: unknown[]) => deactivatePartyMock(...args),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return {
    ...actual,
    useParams: () => ({ partyId: TEST_PARTY_ID }),
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
      <a href={`${to.replace('$partyId', params?.['partyId'] ?? '')}`} {...rest}>
        {children}
      </a>
    ),
  };
});

function party(overrides: Partial<Party> = {}): Party {
  return {
    id: TEST_PARTY_ID,
    type: 'CONSUMER',
    displayName: 'حسین مرادی',
    mobile: '09121234567',
    nationalId: '0012345678',
    linkedTenantId: null,
    status: 'ACTIVE',
    notes: 'مشتری قدیمی',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function balances(overrides: Partial<PartyBalances> = {}): PartyBalances {
  return {
    partyId: TEST_PARTY_ID,
    calculatedAt: new Date().toISOString(),
    defaultDisplayUnit: 'GOLD',
    rawBalances: { rial: '0', pureGoldMg: '412500', coins: [] },
    convertedView: {
      displayUnit: 'GOLD',
      referenceMazneh: {
        id: 'c1000000-0000-4000-8000-000000000001',
        amountRial: '480000000',
        observedAt: new Date().toISOString(),
        goldRatePerGramRial: '480000',
      },
      rialEquivalentPureGoldMg: '0',
      totalGoldDisplayPureMg: '412500',
      coinsRemainSeparate: true,
    },
    ...overrides,
  };
}

function statement(items: PartyStatement['items'] = []): PartyStatement {
  return { items, total: items.length, limit: 5, offset: 0, partyId: TEST_PARTY_ID, displayReferenceMazneh: null };
}

function mockDesktopViewport() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('640px'),
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

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <PartyDetailPage />
    </QueryClientProvider>,
  );
}

const idleQuery = { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };

beforeEach(() => {
  mockDesktopViewport();
  useQueryMocks.useParty.mockReset();
  useQueryMocks.usePartyBalances.mockReset();
  useQueryMocks.usePartyStatement.mockReset();
  useQueryMocks.useLatestPriceQuote.mockReset();
  deactivatePartyMock.mockReset();

  useQueryMocks.useParty.mockReturnValue({ data: party(), isLoading: false, isError: false, refetch: vi.fn() });
  useQueryMocks.usePartyBalances.mockReturnValue({ ...idleQuery, data: balances() });
  useQueryMocks.usePartyStatement.mockReturnValue({ ...idleQuery, data: statement() });
  useQueryMocks.useLatestPriceQuote.mockReturnValue({
    ...idleQuery,
    data: { id: 'c1000000-0000-4000-8000-000000000001', amountRial: 480_000_000n, source: 'MANUAL', observedAt: new Date().toISOString(), createdBy: null, createdAt: new Date().toISOString() },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PartyDetailPage — بارگذاری و خطای اصلی', () => {
  it('در حال بارگذاری شخص: اسکلت نشان می‌دهد', () => {
    useQueryMocks.useParty.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    const { container } = renderPage();
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });

  it('شکست دریافت شخص: پیام خطا و دکمه‌ی تلاش دوباره', async () => {
    const refetch = vi.fn();
    useQueryMocks.useParty.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText('دریافت اطلاعات شخص ناموفق بود.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'تلاش دوباره' }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('PartyDetailPage — مشخصات', () => {
  it('نوع، موبایل، کد ملی و یادداشت را نشان می‌دهد', () => {
    renderPage();
    expect(screen.getByText('مصرف‌کننده')).toBeInTheDocument();
    expect(screen.getByText('09121234567')).toBeInTheDocument();
    expect(screen.getByText('0012345678')).toBeInTheDocument();
    expect(screen.getByText('مشتری قدیمی')).toBeInTheDocument();
  });

  it('لینک «اشخاص» به فهرست برمی‌گردد', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /اشخاص/ })).toHaveAttribute('href', '/parties');
  });

  it('کلیک روی ویرایش، فرم کامل را با مقدار فعلی باز می‌کند', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'ویرایش' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('ویرایش شخص')).toBeInTheDocument();
    expect(screen.getByLabelText('نام')).toHaveValue('حسین مرادی');
  });
});

describe('PartyDetailPage — مانده چندواحدی', () => {
  it('ردیف ریال و طلا را با برچسب بدهکار/بستانکار درست نشان می‌دهد', () => {
    useQueryMocks.usePartyBalances.mockReturnValue({
      ...idleQuery,
      data: balances({ rawBalances: { rial: '10000000', pureGoldMg: '-50000', coins: [] } }),
    });
    renderPage();

    // مثبت = بدهکار، منفی = بستانکار — آینه‌ی `directionFor` واقعی
    expect(screen.getAllByText('بدهکار').length).toBeGreaterThan(0);
    expect(screen.getAllByText('بستانکار').length).toBeGreaterThan(0);
  });

  it('سکه‌ها جدا و بدون تبدیل به گرم نمایش داده می‌شوند', () => {
    useQueryMocks.usePartyBalances.mockReturnValue({
      ...idleQuery,
      data: balances({
        rawBalances: {
          rial: '0',
          pureGoldMg: '0',
          coins: [{ coinTypeId: 'd1000000-0000-4000-8000-000000000001', code: 'تمام بهار آزادی', count: 2 }],
        },
      }),
    });
    renderPage();

    expect(screen.getByText('تمام بهار آزادی')).toBeInTheDocument();
    expect(screen.getByText('۲')).toBeInTheDocument();
  });

  it('بدون مظنه: مقدار خام را نشان می‌دهد و ادعای معادل نمی‌کند', () => {
    useQueryMocks.useLatestPriceQuote.mockReturnValue({ ...idleQuery, data: null });
    useQueryMocks.usePartyBalances.mockReturnValue({ ...idleQuery, data: balances({ convertedView: null }) });
    renderPage();

    expect(screen.getAllByText('معادل واحد دیگر بدون مظنه در دسترس نیست').length).toBeGreaterThan(0);
    expect(screen.getByText('هنوز مظنه‌ای ثبت نشده — مانده کل معادل قابل‌محاسبه نیست.')).toBeInTheDocument();
  });

  it('شکست دریافت مانده: پیام خطا و تلاش دوباره', async () => {
    const refetch = vi.fn();
    useQueryMocks.usePartyBalances.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText('دریافت مانده ناموفق بود.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'تلاش دوباره' }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('PartyDetailPage — آخرین معاملات', () => {
  it('فهرست خالی: پیام مناسب نشان می‌دهد', () => {
    useQueryMocks.usePartyStatement.mockReturnValue({ ...idleQuery, data: statement([]) });
    renderPage();
    expect(screen.getByText('معامله‌ای ثبت نشده')).toBeInTheDocument();
  });

  it('نوع سند و مقدار را بر اساس بُعد فرمت می‌کند', () => {
    useQueryMocks.usePartyStatement.mockReturnValue({
      ...idleQuery,
      data: statement([
        {
          ledgerTransactionId: 'e1',
          source: { type: 'SETTLEMENT', id: 'f1' },
          effectiveAt: new Date().toISOString(),
          description: 'Rial settlement',
          dimension: { id: 'd1', code: 'RIAL', kind: 'RIAL', coinTypeId: null, coinCode: null },
          quantity: '-12000000',
          runningBalance: '0',
          documentRateSnapshots: [],
        },
      ]),
    });
    renderPage();

    // «تسویه» هم برچسب نوع سند این ردیف است هم برچسب مانده‌ی صفر ریالی
    // کارت مانده (فیکسچر پیش‌فرض)، و «ریال» هم همین‌طور برچسب آن ردیف
    // مانده است — هر دو ادعا به خودِ سطر صورت‌حساب محدود می‌شوند
    const row = screen.getByText('تسویه', { selector: '.truncate' }).closest('li');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent(/ریال/);
  });
});

describe('PartyDetailPage — غیرفعال‌سازی', () => {
  it('شخص فعال: دکمه‌ی غیرفعال‌سازی دیده می‌شود؛ شخص غیرفعال: دیده نمی‌شود', () => {
    const { unmount } = renderPage();
    expect(screen.getByRole('button', { name: 'غیرفعال‌سازی' })).toBeInTheDocument();
    unmount();

    useQueryMocks.useParty.mockReturnValue({
      data: party({ status: 'INACTIVE' }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.queryByRole('button', { name: 'غیرفعال‌سازی' })).not.toBeInTheDocument();
  });

  it('تأیید غیرفعال‌سازی، deactivateParty را با شناسه‌ی شخص صدا می‌زند', async () => {
    deactivatePartyMock.mockResolvedValue(party({ status: 'INACTIVE' }));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'غیرفعال‌سازی' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'غیرفعال شود' }));

    await waitFor(() => expect(deactivatePartyMock).toHaveBeenCalledTimes(1));
    expect(deactivatePartyMock).toHaveBeenCalledWith(TEST_PARTY_ID, expect.any(String));
  });

  it('شکست غیرفعال‌سازی: خطا داخل گفت‌وگو می‌ماند و گفت‌وگو بسته نمی‌شود', async () => {
    deactivatePartyMock.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'خطا'));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'غیرفعال‌سازی' }));
    await user.click(screen.getByRole('button', { name: 'غیرفعال شود' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('خطا در انجام عملیات');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('PartyDetailPage — ثبت تسویه', () => {
  it('دکمه‌ی اقدام اصلی به مسیر تسویه‌ی همین شخص لینک می‌دهد', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /ثبت تسویه/ })).toHaveAttribute(
      'href',
      `/parties/${TEST_PARTY_ID}/settlements/new`,
    );
  });
});
