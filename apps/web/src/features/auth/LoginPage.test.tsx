import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouter from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '@/api/api-error';
import { DATA_OWNER_STORAGE_KEY } from '@/lib/tenant-data';
import { useRecentPartiesStore } from '@/stores/recent-parties-store';
import { useSaleDraftStore } from '@/stores/sale-draft-store';
import { useSessionStore } from '@/stores/session-store';
import { LoginPage } from './LoginPage';

/**
 * `useNavigate`/`useSearch` مستقیم mock می‌شوند به‌جای برپاکردن یک روتر
 * کامل — این تست فقط رفتار خودِ `LoginPage` را می‌سنجد (اعتبارسنجی، نگاشت
 * خطا، جلوگیری از دوبار ارسال)، نه ماشین مسیریابی که جای دیگری آزموده
 * می‌شود.
 */
const navigateMock = vi.fn();
let searchValue: { reason?: 'expired' } = {};

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return { ...actual, useNavigate: () => navigateMock, useSearch: () => searchValue };
});

const loginMock = vi.fn();
vi.mock('@/api/auth', () => ({ login: (...args: unknown[]) => loginMock(...args) }));

const VALID_SESSION = {
  accessToken: 'access-abc123',
  refreshToken: 'refresh-xyz789',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'owner@example.com', displayName: 'مدیر فروشگاه' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
  role: 'OWNER',
};

function renderLogin() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LoginPage />
    </QueryClientProvider>,
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('ایمیل'), 'owner@example.com');
  await user.type(screen.getByLabelText('رمز عبور'), 'password123');
  await user.type(screen.getByLabelText('شناسه‌ی فروشگاه'), 'demo');
  await user.click(screen.getByRole('button', { name: 'ورود' }));
}

beforeEach(() => {
  navigateMock.mockReset();
  loginMock.mockReset();
  searchValue = {};
  useSessionStore.setState({ session: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoginPage — فیلدها و اعتبارسنجی', () => {
  it('سه فیلد و دکمه‌ی ورود را نشان می‌دهد', () => {
    renderLogin();
    expect(screen.getByLabelText('ایمیل')).toBeInTheDocument();
    expect(screen.getByLabelText('رمز عبور')).toBeInTheDocument();
    expect(screen.getByLabelText('شناسه‌ی فروشگاه')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ورود' })).toBeInTheDocument();
  });

  it('ارسال خالی هر سه خطای الزامی را نشان می‌دهد و login صدا زده نمی‌شود', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'ورود' }));

    expect(await screen.findByText('ایمیل معتبر نیست')).toBeInTheDocument();
    expect(screen.getByText('رمز عبور الزامی است')).toBeInTheDocument();
    expect(screen.getByText('شناسه‌ی مستأجر الزامی است')).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('هر خطا به ورودی خودش وصل است تا صفحه‌خوان با برگشت به فیلد آن را بخواند (FE-084)', async () => {
    const user = userEvent.setup();
    renderLogin();

    // پیش از خطا، هیچ توضیحی آویزان نیست.
    expect(screen.getByLabelText('ایمیل')).not.toHaveAttribute('aria-describedby');

    await user.click(screen.getByRole('button', { name: 'ورود' }));

    expect(await screen.findByLabelText('ایمیل')).toHaveAccessibleDescription('ایمیل معتبر نیست');
    expect(screen.getByLabelText('رمز عبور')).toHaveAccessibleDescription('رمز عبور الزامی است');
    expect(screen.getByLabelText('شناسه‌ی فروشگاه')).toHaveAccessibleDescription('شناسه‌ی مستأجر الزامی است');
    expect(screen.getByLabelText('ایمیل')).toHaveAttribute('aria-invalid', 'true');
  });

  it('فیلدهای ایمیل و رمز autoComplete مناسب برای مدیر رمز دارند', () => {
    renderLogin();
    expect(screen.getByLabelText('ایمیل')).toHaveAttribute('autoComplete', 'username');
    expect(screen.getByLabelText('رمز عبور')).toHaveAttribute('autoComplete', 'current-password');
  });
});

describe('LoginPage — نمایش/پنهان‌کردن رمز', () => {
  it('با کلیک روی دکمه‌ی چشم، نوع فیلد بین password و text جابه‌جا می‌شود', async () => {
    const user = userEvent.setup();
    renderLogin();

    const passwordInput = screen.getByLabelText('رمز عبور');
    expect(passwordInput).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'نمایش رمز عبور' }));
    expect(passwordInput).toHaveAttribute('type', 'text');

    await user.click(screen.getByRole('button', { name: 'پنهان‌کردن رمز عبور' }));
    expect(passwordInput).toHaveAttribute('type', 'password');
  });
});

describe('LoginPage — ورود موفق (تمام است وقتی #۱)', () => {
  it('نشست را ذخیره و به داشبورد navigate می‌کند', async () => {
    loginMock.mockResolvedValue(VALID_SESSION);
    const user = userEvent.setup();
    renderLogin();

    await fillAndSubmit(user);

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/dashboard' }));
    expect(useSessionStore.getState().session).toEqual(VALID_SESSION);
  });
});

describe('LoginPage — ورود ناموفق (تمام است وقتی #۲)', () => {
  it('۴۰۱ پیام دقیق «ایمیل یا رمز عبور نادرست است» را نشان می‌دهد، نه پیام نشست‌منقضی‌شده', async () => {
    loginMock.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'ایمیل یا رمز عبور نادرست است'));
    const user = userEvent.setup();
    renderLogin();

    await fillAndSubmit(user);

    expect(await screen.findByText('ایمیل یا رمز عبور نادرست است')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(useSessionStore.getState().session).toBeNull();
  });

  it('۴۰۳ (مستأجر معلق) پیام دقیق سرور را نشان می‌دهد', async () => {
    loginMock.mockRejectedValue(
      new ApiError(403, 'FORBIDDEN', 'این مستأجر معلق است و امکان ورود ندارد'),
    );
    const user = userEvent.setup();
    renderLogin();

    await fillAndSubmit(user);

    expect(await screen.findByText('این مستأجر معلق است و امکان ورود ندارد')).toBeInTheDocument();
  });

  it('خطای شبکه پیام عمومی اتصال را نشان می‌دهد', async () => {
    loginMock.mockRejectedValue(new NetworkError());
    const user = userEvent.setup();
    renderLogin();

    await fillAndSubmit(user);

    expect(await screen.findByText('اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.')).toBeInTheDocument();
  });
});

describe('LoginPage — loading و جلوگیری از چند submit', () => {
  it('حین ارسال دکمه غیرفعال می‌شود و بعد از پاسخ دوباره فعال می‌شود', async () => {
    let resolveLogin: (value: typeof VALID_SESSION) => void = () => {};
    loginMock.mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      }),
    );
    const user = userEvent.setup();
    renderLogin();

    await fillAndSubmit(user);
    expect(screen.getByRole('button', { name: 'ورود' })).toBeDisabled();

    resolveLogin(VALID_SESSION);
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
  });

  it('دو کلیک سریع فقط یک فراخوانی login می‌سازد', async () => {
    let resolveLogin: (value: typeof VALID_SESSION) => void = () => {};
    loginMock.mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      }),
    );
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('ایمیل'), 'owner@example.com');
    await user.type(screen.getByLabelText('رمز عبور'), 'password123');
    await user.type(screen.getByLabelText('شناسه‌ی فروشگاه'), 'demo');

    const submitButton = screen.getByRole('button', { name: 'ورود' });
    await user.click(submitButton);
    await user.click(submitButton); // دکمه دیزیبل است، ولی قفل داخلی هم باید نگه دارد

    expect(loginMock).toHaveBeenCalledTimes(1);
    resolveLogin(VALID_SESSION);
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
  });
});

describe('LoginPage — نشست منقضی‌شده', () => {
  it('با reason=expired پیام مربوطه را نشان می‌دهد', () => {
    searchValue = { reason: 'expired' };
    renderLogin();
    expect(screen.getByRole('alert')).toHaveTextContent('نشست قبلی شما منقضی شده است');
  });

  it('بدون reason پیامی نشان داده نمی‌شود', () => {
    searchValue = {};
    renderLogin();
    expect(screen.queryByText(/نشست قبلی شما منقضی شده است/)).not.toBeInTheDocument();
  });
});

describe('LoginPage — token خام در log نمایش داده نمی‌شود (تمام است وقتی #۳)', () => {
  it('نه در موفقیت نه در شکست، توکن خام به console نمی‌رود', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    loginMock.mockResolvedValue(VALID_SESSION);
    const user = userEvent.setup();
    renderLogin();
    await fillAndSubmit(user);
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());

    const allLoggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .map((value) => JSON.stringify(value))
      .join('\n');

    expect(allLoggedText).not.toContain(VALID_SESSION.accessToken);
    expect(allLoggedText).not.toContain(VALID_SESSION.refreshToken);
  });
});

describe('LoginPage — داده‌ی مستأجر یا کاربر قبلی (FE-101)', () => {
  const PREVIOUS_PARTY = {
    id: 'p-old',
    displayName: 'مشتری فروشگاه قبلی',
    mobile: '09120000000',
    type: 'CONSUMER',
    status: 'ACTIVE',
  } as const;

  beforeEach(() => {
    localStorage.removeItem(DATA_OWNER_STORAGE_KEY);
    useRecentPartiesStore.setState({ recent: [PREVIOUS_PARTY] });
    useSaleDraftStore.setState({ party: PREVIOUS_PARTY, step: 'ITEMS' });
  });

  afterEach(() => {
    useRecentPartiesStore.getState().clear();
    useSaleDraftStore.getState().reset();
    localStorage.removeItem(DATA_OWNER_STORAGE_KEY);
  });

  it('ورود مستأجر دیگر، فهرست اخیر و پیش‌نویس قبلی را پیش از نشست تازه پاک می‌کند', async () => {
    localStorage.setItem(DATA_OWNER_STORAGE_KEY, 't-other:u-other');
    loginMock.mockResolvedValue(VALID_SESSION);
    const user = userEvent.setup();
    renderLogin();
    await fillAndSubmit(user);
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());

    expect(useRecentPartiesStore.getState().recent).toEqual([]);
    expect(useSaleDraftStore.getState().party).toBeNull();
    expect(localStorage.getItem(DATA_OWNER_STORAGE_KEY)).toBe('t1:u1');
  });

  it('مالک نامعلوم (داده‌ی پیش از FE-101) هم پاک می‌شود — سمت امن', async () => {
    loginMock.mockResolvedValue(VALID_SESSION);
    const user = userEvent.setup();
    renderLogin();
    await fillAndSubmit(user);
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());

    expect(useRecentPartiesStore.getState().recent).toEqual([]);
  });

  it('ورود دوباره‌ی همان کاربر همان مستأجر، پیش‌نویس و فهرست اخیرش را نگه می‌دارد', async () => {
    localStorage.setItem(DATA_OWNER_STORAGE_KEY, 't1:u1');
    loginMock.mockResolvedValue(VALID_SESSION);
    const user = userEvent.setup();
    renderLogin();
    await fillAndSubmit(user);
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());

    expect(useRecentPartiesStore.getState().recent).toEqual([PREVIOUS_PARTY]);
    expect(useSaleDraftStore.getState().party).toEqual(PREVIOUS_PARTY);
  });

  it('ورود ناموفق چیزی پاک نمی‌کند', async () => {
    localStorage.setItem(DATA_OWNER_STORAGE_KEY, 't-other:u-other');
    loginMock.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'ایمیل یا رمز عبور اشتباه است'));
    const user = userEvent.setup();
    renderLogin();
    await fillAndSubmit(user);
    await screen.findByText('ایمیل یا رمز عبور اشتباه است');

    expect(useRecentPartiesStore.getState().recent).toEqual([PREVIOUS_PARTY]);
    expect(localStorage.getItem(DATA_OWNER_STORAGE_KEY)).toBe('t-other:u-other');
  });
});
