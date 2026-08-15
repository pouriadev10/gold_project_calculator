import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from '@/stores/session-store';
import { useHasRole } from './useHasRole';

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

describe('useHasRole — FE-028', () => {
  it('بدون نشست، همیشه false است — رد پیش‌فرض', () => {
    const { result } = renderHook(() => useHasRole(['OWNER', 'MANAGER', 'CASHIER']));
    expect(result.current).toBe(false);
  });

  it('نقش داخل فهرست مجاز → true', () => {
    useSessionStore.setState({ session: sessionWithRole('MANAGER') });
    const { result } = renderHook(() => useHasRole(['OWNER', 'MANAGER']));
    expect(result.current).toBe(true);
  });

  it('نقش خارج از فهرست مجاز → false — فهرست سفید است، نه سلسله‌مراتب', () => {
    useSessionStore.setState({ session: sessionWithRole('CASHIER') });
    const { result } = renderHook(() => useHasRole(['OWNER', 'MANAGER']));
    expect(result.current).toBe(false);
  });

  it('OWNER هم اگر صریح در فهرست نباشد رد می‌شود — بدون سلسله‌مراتب ضمنی', () => {
    useSessionStore.setState({ session: sessionWithRole('OWNER') });
    const { result } = renderHook(() => useHasRole(['CASHIER']));
    expect(result.current).toBe(false);
  });
});
