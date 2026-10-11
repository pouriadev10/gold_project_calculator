import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type * as ReactRouter from '@tanstack/react-router';
import type { CoinTypeCatalog, CoinTypeVersion, SessionResponse } from '@/api/contracts';
import type * as CoinTypesApi from '@/api/coin-types';
import type * as Queries from '@/api/queries';
import { ApiError } from '@/api/api-error';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import { useSessionStore } from '@/stores/session-store';
import CoinTypeSettingsPage, { formatCoinWeightUg } from './CoinTypeSettingsPage';

/** FE-081 — صفحه‌ی تنظیمات انواع سکه. */

const useCoinTypeCatalogMock = vi.fn();
vi.mock('@/api/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof Queries>()),
  useCoinTypeCatalog: (...args: unknown[]) => useCoinTypeCatalogMock(...args),
}));

const createCoinTypeMock = vi.fn();
const createCoinTypeVersionMock = vi.fn();
vi.mock('@/api/coin-types', async (importOriginal) => ({
  ...(await importOriginal<typeof CoinTypesApi>()),
  createCoinType: (...args: unknown[]) => createCoinTypeMock(...args),
  createCoinTypeVersion: (...args: unknown[]) => createCoinTypeVersionMock(...args),
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

const NIM_ID = 'd1000000-0000-4000-8000-000000000002';
const PARSIAN_ID = 'd1000000-0000-4000-8000-000000000009';
const V1_FROM = '2026-07-01T00:00:00.000Z';
const V2_FROM = '2026-09-01T00:00:00.000Z';

function version(overrides: Partial<CoinTypeVersion> & Pick<CoinTypeVersion, 'id' | 'coinTypeId' | 'code'>): CoinTypeVersion {
  return {
    title: 'نیم سکه بهار آزادی',
    grossWeightUg: '4066500',
    karat: 900,
    validFrom: V1_FROM,
    validTo: null,
    version: 1,
    active: true,
    mintType: 'CENTRAL_BANK',
    isCentralBankMinted: true,
    ...overrides,
  } as CoinTypeVersion;
}

const NIM_V2 = version({ id: 'e1000000-0000-4000-8000-000000000012', coinTypeId: NIM_ID, code: 'NIM', version: 2, validFrom: V2_FROM });
const NIM_V1 = version({
  id: 'e1000000-0000-4000-8000-000000000002',
  coinTypeId: NIM_ID,
  code: 'NIM',
  title: 'نیم سکه',
  grossWeightUg: '4066000',
  validTo: V2_FROM,
});
const PARSIAN = version({
  id: 'e1000000-0000-4000-8000-000000000009',
  coinTypeId: PARSIAN_ID,
  code: 'PARSIAN',
  title: 'سکه پارسیان',
  grossWeightUg: '1500000',
  karat: 750,
  mintType: 'PRIVATE_MINT',
  isCentralBankMinted: false,
  active: false,
});

const CATALOG: CoinTypeCatalog = {
  types: [
    { coinTypeId: NIM_ID, code: 'NIM', versions: [NIM_V2, NIM_V1] },
    { coinTypeId: PARSIAN_ID, code: 'PARSIAN', versions: [PARSIAN] },
  ],
};

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

function renderPage() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <CoinTypeSettingsPage />
      <NumericKeypad />
    </QueryClientProvider>,
  );
  return { invalidate };
}

function card(title: string): HTMLElement {
  return screen.getByRole('heading', { name: title }).closest('[aria-label]') as HTMLElement;
}

async function typeDigits(user: ReturnType<typeof userEvent.setup>, digits: string) {
  for (const digit of digits) {
    const name = digit === '.' ? 'جداکننده اعشار' : `رقم ${String.fromCodePoint(0x06f0 + Number.parseInt(digit, 10))}`;
    await user.click(screen.getByRole('button', { name }));
  }
}

beforeEach(() => {
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
  useCoinTypeCatalogMock.mockReset();
  useCoinTypeCatalogMock.mockReturnValue({ data: CATALOG, isLoading: false, isError: false, refetch: vi.fn() });
  createCoinTypeMock.mockReset();
  createCoinTypeVersionMock.mockReset();
  useSessionStore.setState({ session: session('MANAGER') });
});

afterEach(() => {
  useSessionStore.setState({ session: null });
});

describe('formatCoinWeightUg', () => {
  it('shows exact micrograms without rounding', () => {
    expect(formatCoinWeightUg(8_133_000n)).toBe('۸٫۱۳۳');
    expect(formatCoinWeightUg(4_066_500n)).toBe('۴٫۰۶۶۵۰۰');
  });
});

describe('CoinTypeSettingsPage — FE-081', () => {
  it('lists each type from the API with weight, karat, mint, active state and validity', () => {
    renderPage();

    const nim = card('نیم سکه بهار آزادی');
    expect(within(nim).getByText('۴٫۰۶۶۵۰۰ گرم')).toBeInTheDocument();
    expect(within(nim).getByText('۹۰۰')).toBeInTheDocument();
    expect(within(nim).getByText('ضرب بانک مرکزی')).toBeInTheDocument();
    expect(within(nim).getByText('فعال')).toBeInTheDocument();
    expect(within(nim).getByText('اعتبار نسخه ۲')).toBeInTheDocument();
    expect(within(nim).getByText(/تا اکنون$/)).toBeInTheDocument();

    const parsian = card('سکه پارسیان');
    expect(within(parsian).getByText('ضرب خصوصی')).toBeInTheDocument();
    expect(within(parsian).getByText('غیرفعال')).toBeInTheDocument();
    expect(within(parsian).getByText('۷۵۰')).toBeInTheDocument();
  });

  it('marks only central-bank coins as bubble-bearing', () => {
    renderPage();

    expect(within(card('نیم سکه بهار آزادی')).getByText('حباب‌دار')).toBeInTheDocument();
    expect(within(card('سکه پارسیان')).queryByText('حباب‌دار')).not.toBeInTheDocument();
  });

  it('shows the full version history with each validity range', async () => {
    const user = userEvent.setup();
    renderPage();

    const toggle = within(card('نیم سکه بهار آزادی')).getByRole('button', { name: /تاریخچه نسخه‌ها \(۲\)/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const history = screen.getByRole('list', { name: 'تاریخچه نسخه‌های نیم سکه بهار آزادی' });
    const items = within(history).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('نسخه ۲');
    expect(items[0]).toHaveTextContent(/تا اکنون/);
    expect(items[1]).toHaveTextContent('نسخه ۱ · نیم سکه');
    expect(items[1]).toHaveTextContent('۴٫۰۶۶ گرم');
    expect(items[1]?.textContent).not.toMatch(/تا اکنون/);
  });

  it('a cashier can read but never create a type or version', () => {
    useSessionStore.setState({ session: session('CASHIER') });
    renderPage();

    expect(screen.getByText('فقط مالک و مدیر می‌توانند نوع یا نسخه‌ی تازه بسازند.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'نسخه جدید' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'افزودن نوع سکه' })).not.toBeInTheDocument();
  });

  it('a new version starts from the current values and is sent as a new version, not an edit', async () => {
    const user = userEvent.setup();
    createCoinTypeVersionMock.mockResolvedValue({ ...NIM_V2, id: 'e1000000-0000-4000-8000-000000000022', version: 3, active: false });
    const { invalidate } = renderPage();

    await user.click(within(card('نیم سکه بهار آزادی')).getByRole('button', { name: 'نسخه جدید' }));
    expect(screen.getByLabelText('عنوان')).toHaveValue('نیم سکه بهار آزادی');
    expect(screen.getByLabelText('وزن ناخالص مرجع')).toHaveAttribute('data-value', '4066500');
    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '900');
    expect(screen.getByLabelText('نوع ضرب')).toHaveValue('CENTRAL_BANK');
    const save = screen.getByRole('button', { name: 'ذخیره نسخه جدید' });
    expect(save).toBeDisabled();
    expect(screen.getByText(/فاکتورها و خریدهای گذشته با مشخصات زمان خودشان/)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /فعال/ }));
    expect(screen.getByText(/نوع غیرفعال در معامله‌ی تازه انتخاب نمی‌شود/)).toBeInTheDocument();
    await user.click(save);

    await waitFor(() =>
      expect(createCoinTypeVersionMock).toHaveBeenCalledWith(
        NIM_ID,
        { title: 'نیم سکه بهار آزادی', mintType: 'CENTRAL_BANK', grossWeightUg: '4066500', karat: 900, active: false },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['coin-types'] }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'ذخیره نسخه جدید' })).not.toBeInTheDocument());
  });

  it('explains the bubble consequence of the mint type and never sends isCentralBankMinted', async () => {
    const user = userEvent.setup();
    createCoinTypeVersionMock.mockResolvedValue({ ...PARSIAN, version: 2 });
    renderPage();

    await user.click(within(card('نیم سکه بهار آزادی')).getByRole('button', { name: 'نسخه جدید' }));
    expect(screen.getByText(/حباب‌دار: قیمت بازار این سکه/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('نوع ضرب'), 'OTHER');
    expect(screen.getByText('بدون حباب: فقط سکه‌ی ضرب بانک مرکزی حباب دارد.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ذخیره نسخه جدید' }));

    await waitFor(() => expect(createCoinTypeVersionMock).toHaveBeenCalled());
    const [, input] = createCoinTypeVersionMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(input['mintType']).toBe('OTHER');
    expect(input).not.toHaveProperty('isCentralBankMinted');
  });

  it('keeps the editor open with the server error when saving fails', async () => {
    const user = userEvent.setup();
    createCoinTypeVersionMock.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'forbidden'));
    renderPage();

    await user.click(within(card('نیم سکه بهار آزادی')).getByRole('button', { name: 'نسخه جدید' }));
    await user.click(screen.getByLabelText('عیار'));
    await user.click(screen.getByRole('button', { name: 'حذف یک رقم — برای پاک‌کردن کل فیلد نگه دارید' }));
    await typeDigits(user, '5');
    await user.click(screen.getByRole('button', { name: 'ذخیره نسخه جدید' }));

    expect(await screen.findByText('اجازه انجام این عملیات را ندارید')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ذخیره نسخه جدید' })).toBeInTheDocument();
  });

  it('a new type starts empty — no hardcoded weight, karat or mint — and validates before sending', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'افزودن نوع سکه' }));
    expect(screen.getByLabelText(/کد نوع/)).toHaveValue('');
    expect(screen.getByLabelText('عنوان')).toHaveValue('');
    expect(screen.getByLabelText('نوع ضرب')).toHaveValue('');
    expect(screen.getByLabelText('وزن ناخالص مرجع')).toHaveAttribute('data-value', '0');
    expect(screen.getByLabelText('عیار')).toHaveAttribute('data-value', '0');

    await user.click(screen.getByRole('button', { name: 'ثبت نوع سکه' }));

    expect(screen.getByText('کد الزامی است')).toBeInTheDocument();
    expect(screen.getByText('عنوان الزامی است')).toBeInTheDocument();
    expect(screen.getByText('نوع ضرب را انتخاب کنید')).toBeInTheDocument();
    expect(screen.getByText('وزن ناخالص باید بزرگ‌تر از صفر باشد')).toBeInTheDocument();
    expect(screen.getByText('عیار باید بین ۱ و ۱۰۰۰ باشد')).toBeInTheDocument();
    expect(createCoinTypeMock).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/کد نوع/), 'NIM');
    expect(screen.getByText('این کد قبلاً برای نوع سکه‌ی دیگری ثبت شده است')).toBeInTheDocument();
  });

  it('creates a new type with an exact microgram weight', async () => {
    const user = userEvent.setup();
    createCoinTypeMock.mockResolvedValue(
      version({ id: 'e1000000-0000-4000-8000-000000000031', coinTypeId: 'd1000000-0000-4000-8000-000000000031', code: 'ROB' }),
    );
    const { invalidate } = renderPage();

    await user.click(screen.getByRole('button', { name: 'افزودن نوع سکه' }));
    await user.type(screen.getByLabelText(/کد نوع/), 'ROB');
    await user.type(screen.getByLabelText('عنوان'), 'ربع سکه');
    await user.selectOptions(screen.getByLabelText('نوع ضرب'), 'CENTRAL_BANK');
    await user.click(screen.getByLabelText('وزن ناخالص مرجع'));
    await typeDigits(user, '2.0332');
    expect(screen.getByLabelText('وزن ناخالص مرجع')).toHaveAttribute('data-value', '2033200');
    await user.click(screen.getByLabelText('عیار'));
    await typeDigits(user, '900');
    await user.click(screen.getByRole('button', { name: 'ثبت نوع سکه' }));

    await waitFor(() =>
      expect(createCoinTypeMock).toHaveBeenCalledWith(
        { code: 'ROB', title: 'ربع سکه', mintType: 'CENTRAL_BANK', grossWeightUg: '2033200', karat: 900, active: true },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['coin-types'] }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'افزودن نوع سکه' })).toBeInTheDocument());
  });

  it('shows loading, empty and a retryable error', async () => {
    useCoinTypeCatalogMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <CoinTypeSettingsPage />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText('در حال دریافت انواع سکه')).toBeInTheDocument();
    unmount();

    useCoinTypeCatalogMock.mockReturnValue({ data: { types: [] }, isLoading: false, isError: false, refetch: vi.fn() });
    const empty = render(
      <QueryClientProvider client={new QueryClient()}>
        <CoinTypeSettingsPage />
      </QueryClientProvider>,
    );
    expect(screen.getByText('هنوز نوع سکه‌ای تعریف نشده')).toBeInTheDocument();
    empty.unmount();

    const refetch = vi.fn();
    useCoinTypeCatalogMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: /تلاش/ }));
    expect(refetch).toHaveBeenCalled();
  });
});
