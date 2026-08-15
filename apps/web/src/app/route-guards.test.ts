import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from '@/stores/session-store';
import { requireAuth, requireRole } from './route-guards';

/**
 * `redirect({ to })` در نسخه‌ی نصب‌شده یک نمونه‌ی `Response` برمی‌گرداند
 * (نه پرتاب می‌کند) با مقصد داخل `.options.to` — این کمکی همان را از
 * بلوک catch بیرون می‌کشد، بدون وابستگی به بقیه‌ی شکل داخلی TanStack Router.
 */
function redirectTarget(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return (error as { options?: { to?: string } }).options?.to;
  }
}

const sessionWithRole = (role: 'OWNER' | 'MANAGER' | 'CASHIER') => ({
  accessToken: 'a',
  refreshToken: 'r',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'x@example.com', displayName: 'کاربر' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه' },
  role,
});

beforeEach(() => {
  useSessionStore.setState({ session: null });
});

describe('requireAuth — FE-028', () => {
  it('بدون نشست به /login هدایت می‌کند', () => {
    expect(redirectTarget(requireAuth)).toBe('/login');
  });

  it('با نشست، چیزی پرتاب نمی‌کند', () => {
    useSessionStore.setState({ session: sessionWithRole('CASHIER') });
    expect(() => requireAuth()).not.toThrow();
  });
});

describe('requireRole — FE-028 (تمام است وقتی: لینک مستقیم پاسخ مناسب بدهد)', () => {
  it('بدون نشست به /forbidden هدایت می‌کند', () => {
    const guard = requireRole(['OWNER', 'MANAGER']);
    expect(redirectTarget(guard)).toBe('/forbidden');
  });

  it('نقش خارج از فهرست مجاز (CASHIER برای گزارش سود) به /forbidden هدایت می‌کند', () => {
    useSessionStore.setState({ session: sessionWithRole('CASHIER') });
    const guard = requireRole(['OWNER', 'MANAGER']);
    expect(redirectTarget(guard)).toBe('/forbidden');
  });

  it('نقش داخل فهرست مجاز چیزی پرتاب نمی‌کند', () => {
    useSessionStore.setState({ session: sessionWithRole('MANAGER') });
    const guard = requireRole(['OWNER', 'MANAGER']);
    expect(() => guard()).not.toThrow();
  });

  it('فهرست سفید است — OWNER هم اگر صریح در فهرست نباشد رد می‌شود', () => {
    useSessionStore.setState({ session: sessionWithRole('OWNER') });
    const guard = requireRole(['CASHIER']);
    expect(redirectTarget(guard)).toBe('/forbidden');
  });
});
