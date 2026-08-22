import type * as ReactRouter from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/stores/session-store';
import type { MaznehSnapshot } from './useMazneh';

/** `<Link>` بدون RouterProvider خطا می‌دهد — اینجا فقط یک anchor ساده لازم است. */
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return {
    ...actual,
    Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

const useManznehMock = vi.fn();
vi.mock('./useMazneh', () => ({ useMazneh: () => useManznehMock() }));

import { MaznehBar } from './MaznehBar';

const SNAPSHOT: MaznehSnapshot = {
  quoteId: 'c1000000-0000-4000-8000-000000000001',
  mazneh: 480_000_000n,
  gram750: 110_808_388n,
  gram1000: 147_744_518n,
  source: 'MANUAL',
  observedAt: new Date(),
  isStale: false,
};

const sessionWithRole = (role: 'OWNER' | 'MANAGER' | 'CASHIER') => ({
  accessToken: 'a',
  refreshToken: 'r',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'x@example.com', displayName: 'کاربر' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه' },
  role,
});

beforeEach(() => {
  useManznehMock.mockReset();
  useSessionStore.setState({ session: sessionWithRole('OWNER') });
});

describe('MaznehBar — حالت‌ها (تمام است وقتی: loading/empty/stale/error)', () => {
  it('در حال بارگذاری: اسکلت نشان می‌دهد', () => {
    useManznehMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isEmpty: false,
      refetch: vi.fn(),
    });
    const { container } = render(<MaznehBar isOnline />);
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });

  it('شکست دریافت: پیام خطا و دکمه‌ی تلاش دوباره — بقیه‌ی نوار (وضعیت آنلاین) همچنان دیده می‌شود', async () => {
    const refetch = vi.fn();
    useManznehMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isEmpty: false,
      refetch,
    });
    const user = userEvent.setup();
    render(<MaznehBar isOnline />);

    expect(screen.getByText('دریافت مظنه ناموفق بود.')).toBeInTheDocument();
    expect(screen.getByText('آنلاین')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'تلاش دوباره' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('خالی: پیام «هنوز مظنه‌ای ثبت نشده» را نشان می‌دهد', () => {
    useManznehMock.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      isEmpty: true,
      refetch: vi.fn(),
    });
    render(<MaznehBar isOnline />);
    expect(screen.getByText('هنوز مظنه‌ای ثبت نشده است.')).toBeInTheDocument();
  });

  it('قدیمی: نشان هشدار «مظنه قدیمی است» را کنار مقادیر نشان می‌دهد', () => {
    useManznehMock.mockReturnValue({
      data: { ...SNAPSHOT, isStale: true },
      isLoading: false,
      isError: false,
      isEmpty: false,
      refetch: vi.fn(),
    });
    render(<MaznehBar isOnline />);
    expect(screen.getByText('مظنه قدیمی است')).toBeInTheDocument();
  });

  it('تازه: بدون نشان هشدار، مقادیر و منبع را نشان می‌دهد', () => {
    useManznehMock.mockReturnValue({
      data: SNAPSHOT,
      isLoading: false,
      isError: false,
      isEmpty: false,
      refetch: vi.fn(),
    });
    render(<MaznehBar isOnline />);
    expect(screen.queryByText('مظنه قدیمی است')).not.toBeInTheDocument();
    expect(screen.getByText('منبع: دستی')).toBeInTheDocument();
    expect(screen.getByText('مظنه مثقال')).toBeInTheDocument();
    expect(screen.getByText('گرم ۷۵۰')).toBeInTheDocument();
  });
});

describe('MaznehBar — وضعیت اتصال', () => {
  it('isOnline=false برچسب «آفلاین» را نشان می‌دهد', () => {
    useManznehMock.mockReturnValue({
      data: SNAPSHOT,
      isLoading: false,
      isError: false,
      isEmpty: false,
      refetch: vi.fn(),
    });
    render(<MaznehBar isOnline={false} />);
    expect(screen.getByText('آفلاین')).toBeInTheDocument();
  });
});

describe('MaznehBar — اقدام ورود دستی (نقش‌محور، FE-028)', () => {
  beforeEach(() => {
    useManznehMock.mockReturnValue({
      data: SNAPSHOT,
      isLoading: false,
      isError: false,
      isEmpty: false,
      refetch: vi.fn(),
    });
  });

  it('برای OWNER/MANAGER دیده می‌شود', () => {
    useSessionStore.setState({ session: sessionWithRole('MANAGER') });
    render(<MaznehBar isOnline />);
    expect(screen.getByRole('link', { name: /ثبت دستی/ })).toBeInTheDocument();
  });

  it('برای CASHIER پنهان است — همان نقش‌هایی که POST /pricing/quotes/manual اجازه می‌دهد', () => {
    useSessionStore.setState({ session: sessionWithRole('CASHIER') });
    render(<MaznehBar isOnline />);
    expect(screen.queryByRole('link', { name: /ثبت دستی/ })).not.toBeInTheDocument();
  });
});
