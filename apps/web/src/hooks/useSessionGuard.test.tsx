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
import { B2C_BUYBACK_ATTEMPT_STORAGE_PREFIX, SUBMIT_ATTEMPT_STORAGE_PREFIX } from '@/lib/submit-attempt-storage';
import { DATA_OWNER_STORAGE_KEY } from '@/lib/tenant-data';
import { usePurchaseDraftStore } from '@/stores/purchase-draft-store';
import { useRecentPartiesStore } from '@/stores/recent-parties-store';
import { useSaleDraftStore } from '@/stores/sale-draft-store';
import { useToastStore } from '@/stores/toast-store';

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
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
  role: 'OWNER' as const,
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

describe('useSessionGuard — داده‌ی مستأجر (FE-101)', () => {
  const PARTY = { id: 'p1', displayName: 'مشتری', mobile: '09120000000', type: 'CONSUMER', status: 'ACTIVE' } as const;
  const ATTEMPT_KEY = `${SUBMIT_ATTEMPT_STORAGE_PREFIX}t1:u1:sale:coin`;
  const B2C_KEY = `${B2C_BUYBACK_ATTEMPT_STORAGE_PREFIX}inv-1`;

  function seedTenantData() {
    useRecentPartiesStore.setState({ recent: [PARTY] });
    useSaleDraftStore.setState({ party: PARTY, step: 'ITEMS' });
    usePurchaseDraftStore.setState({ seller: PARTY, grossWeightMg: '1000' });
    sessionStorage.setItem(ATTEMPT_KEY, '{"key":"k","payload":{}}');
    sessionStorage.setItem(B2C_KEY, '{"key":"k","input":{}}');
    sessionStorage.setItem('unrelated', 'x');
    localStorage.setItem(DATA_OWNER_STORAGE_KEY, 't1:u1');
    useToastStore.getState().push({ variant: 'success', title: 'فروش ثبت شد', description: 'مشتری' });
  }

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('خروج عمدی: کش، پیش‌نویس‌ها، اشخاص اخیر، تلاش‌های ثبت، toast و مالک داده پاک می‌شوند', async () => {
    useSessionStore.setState({ session: SESSION });
    seedTenantData();
    const clearSpy = renderGuard();

    markDeliberateLogout();
    useSessionStore.getState().clearSession();

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(clearSpy).toHaveBeenCalled();
    expect(useRecentPartiesStore.getState().recent).toEqual([]);
    expect(useSaleDraftStore.getState().party).toBeNull();
    expect(usePurchaseDraftStore.getState().seller).toBeNull();
    expect(sessionStorage.getItem(ATTEMPT_KEY)).toBeNull();
    expect(sessionStorage.getItem(B2C_KEY)).toBeNull();
    expect(sessionStorage.getItem('unrelated')).toBe('x');
    expect(useToastStore.getState().toasts).toEqual([]);
    expect(localStorage.getItem(DATA_OWNER_STORAGE_KEY)).toBeNull();
  });

  it('انقضای نشست: فقط کش پاک می‌شود — پیش‌نویس همان کاربر برای ورود دوباره می‌ماند', async () => {
    useSessionStore.setState({ session: SESSION });
    seedTenantData();
    const clearSpy = renderGuard();

    useSessionStore.getState().clearSession();

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(clearSpy).toHaveBeenCalled();
    expect(useSaleDraftStore.getState().party).toEqual(PARTY);
    expect(sessionStorage.getItem(ATTEMPT_KEY)).not.toBeNull();
    // مالک می‌ماند تا ورود کاربر دیگر (claimTenantData) بقیه را پاک کند
    expect(localStorage.getItem(DATA_OWNER_STORAGE_KEY)).toBe('t1:u1');
  });
});
