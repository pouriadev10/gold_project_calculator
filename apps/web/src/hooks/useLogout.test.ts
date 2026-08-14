import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeDeliberateLogoutFlag, useSessionStore } from '@/stores/session-store';
import { useLogout } from './useLogout';

const logoutMock = vi.fn();
vi.mock('@/api/auth', () => ({ logout: (...args: unknown[]) => logoutMock(...args) }));

const SESSION = {
  accessToken: 'a',
  refreshToken: 'r-123',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'owner@example.com', displayName: 'مدیر فروشگاه' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه' },
  role: 'OWNER',
};

beforeEach(() => {
  logoutMock.mockReset();
  useSessionStore.setState({ session: null });
  consumeDeliberateLogoutFlag();
});

describe('useLogout', () => {
  it('با نشست فعال، سرور را با توکن تمدید صدا می‌زند و بعد نشست را محلی پاک می‌کند', async () => {
    useSessionStore.setState({ session: SESSION });
    logoutMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useLogout());

    await act(() => result.current.logout());

    expect(logoutMock).toHaveBeenCalledWith('r-123');
    expect(useSessionStore.getState().session).toBeNull();
  });

  it('پرچم خروج عمدی را روشن می‌کند — تا useSessionGuard آن را با «منقضی‌شده» اشتباه نگیرد', async () => {
    useSessionStore.setState({ session: SESSION });
    logoutMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useLogout());

    await act(() => result.current.logout());

    expect(consumeDeliberateLogoutFlag()).toBe(true);
  });

  it('شکست شبکه هم خروج محلی را انجام می‌دهد — تلاش با بهترین کوشش', async () => {
    useSessionStore.setState({ session: SESSION });
    logoutMock.mockRejectedValue(new Error('قطع شبکه'));
    const { result } = renderHook(() => useLogout());

    await act(() => result.current.logout());

    expect(useSessionStore.getState().session).toBeNull();
  });

  it('isLoggingOut حین فراخوانی true و بعدش false است', async () => {
    let resolveLogout: () => void = () => {};
    logoutMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveLogout = resolve;
      }),
    );
    useSessionStore.setState({ session: SESSION });
    const { result } = renderHook(() => useLogout());

    let logoutPromise!: Promise<void>;
    act(() => {
      logoutPromise = result.current.logout();
    });
    await waitFor(() => expect(result.current.isLoggingOut).toBe(true));

    resolveLogout();
    await act(() => logoutPromise);
    expect(result.current.isLoggingOut).toBe(false);
  });
});
