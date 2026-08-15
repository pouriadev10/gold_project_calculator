import type * as ReactRouter from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from '@/api/api-error';
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
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه' },
  role: 'OWNER',
};

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
    render(<LoginPage />);
    expect(screen.getByLabelText('ایمیل')).toBeInTheDocument();
    expect(screen.getByLabelText('رمز عبور')).toBeInTheDocument();
    expect(screen.getByLabelText('شناسه‌ی فروشگاه')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ورود' })).toBeInTheDocument();
  });

  it('ارسال خالی هر سه خطای الزامی را نشان می‌دهد و login صدا زده نمی‌شود', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole('button', { name: 'ورود' }));

    expect(await screen.findByText('ایمیل معتبر نیست')).toBeInTheDocument();
    expect(screen.getByText('رمز عبور الزامی است')).toBeInTheDocument();
    expect(screen.getByText('شناسه‌ی مستأجر الزامی است')).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('فیلدهای ایمیل و رمز autoComplete مناسب برای مدیر رمز دارند', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText('ایمیل')).toHaveAttribute('autoComplete', 'username');
    expect(screen.getByLabelText('رمز عبور')).toHaveAttribute('autoComplete', 'current-password');
  });
});

describe('LoginPage — نمایش/پنهان‌کردن رمز', () => {
  it('با کلیک روی دکمه‌ی چشم، نوع فیلد بین password و text جابه‌جا می‌شود', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

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
    render(<LoginPage />);

    await fillAndSubmit(user);

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/dashboard' }));
    expect(useSessionStore.getState().session).toEqual(VALID_SESSION);
  });
});

describe('LoginPage — ورود ناموفق (تمام است وقتی #۲)', () => {
  it('۴۰۱ پیام دقیق «ایمیل یا رمز عبور نادرست است» را نشان می‌دهد، نه پیام نشست‌منقضی‌شده', async () => {
    loginMock.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'ایمیل یا رمز عبور نادرست است'));
    const user = userEvent.setup();
    render(<LoginPage />);

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
    render(<LoginPage />);

    await fillAndSubmit(user);

    expect(await screen.findByText('این مستأجر معلق است و امکان ورود ندارد')).toBeInTheDocument();
  });

  it('خطای شبکه پیام عمومی اتصال را نشان می‌دهد', async () => {
    loginMock.mockRejectedValue(new NetworkError());
    const user = userEvent.setup();
    render(<LoginPage />);

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
    render(<LoginPage />);

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
    render(<LoginPage />);

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
    render(<LoginPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('نشست قبلی شما منقضی شده است');
  });

  it('بدون reason پیامی نشان داده نمی‌شود', () => {
    searchValue = {};
    render(<LoginPage />);
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
    render(<LoginPage />);
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
