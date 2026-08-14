import type * as ReactRouter from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumeDeliberateLogoutFlag,
  markDeliberateLogout,
  SESSION_STORAGE_KEY,
  useSessionStore,
} from '@/stores/session-store';

const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return { ...actual, useNavigate: () => navigateMock };
});

import { useSessionGuard } from './useSessionGuard';

const SESSION = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'owner@example.com', displayName: 'مدیر فروشگاه' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه' },
  role: 'OWNER',
};

function renderGuard() {
  const client = new QueryClient();
  const clearSpy = vi.spyOn(client, 'clear');
  renderHook(() => useSessionGuard(), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  return clearSpy;
}

beforeEach(() => {
  navigateMock.mockReset();
  localStorage.clear();
  useSessionStore.setState({ session: null });
  consumeDeliberateLogoutFlag();
});

describe('useSessionGuard — گذار نشست', () => {
  it('نشست فعال → null: کش پاک و به ورود با reason=expired هدایت می‌شود', async () => {
    useSessionStore.setState({ session: SESSION });
    const clearSpy = renderGuard();

    useSessionStore.getState().clearSession();

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(navigateMock).toHaveBeenCalledWith({ to: '/login', search: { reason: 'expired' } });
    expect(clearSpy).toHaveBeenCalled();
  });

  it('پرچم خروج عمدی روشن باشد: بدون reason هدایت می‌شود', async () => {
    useSessionStore.setState({ session: SESSION });
    renderGuard();

    markDeliberateLogout();
    useSessionStore.getState().clearSession();

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(navigateMock).toHaveBeenCalledWith({ to: '/login', search: {} });
  });

  it('در mount اول بدون نشست، هدایتی رخ نمی‌دهد — هنوز Route Guard (FE-028) نیست', async () => {
    renderGuard();

    // به یک چرخه فرصت بده تا اگر اشتباهی effect زودهنگام navigate می‌زد، دیده شود
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('نشستی که به نشست دیگر عوض می‌شود (نه null) هدایت نمی‌کند', async () => {
    useSessionStore.setState({ session: SESSION });
    renderGuard();

    useSessionStore.getState().setSession({ ...SESSION, accessToken: 'new-token' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe('useSessionGuard — همگام‌سازی بین تب‌ها', () => {
  it('رویداد storage با کلید نشست، خروج تب دیگر را رصد و هدایت می‌کند', async () => {
    useSessionStore.setState({ session: SESSION });
    renderGuard();

    // شبیه‌سازی تب دیگری که خروج زده: مستقیم در localStorage می‌نویسیم
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ state: { session: null }, version: 0 }));
    window.dispatchEvent(new StorageEvent('storage', { key: SESSION_STORAGE_KEY }));

    await waitFor(() => expect(useSessionStore.getState().session).toBeNull());
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
  });

  it('رویداد storage با کلید نامرتبط را نادیده می‌گیرد', async () => {
    useSessionStore.setState({ session: SESSION });
    renderGuard();

    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated-key' }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(useSessionStore.getState().session).toEqual(SESSION);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
