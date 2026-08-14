import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumeDeliberateLogoutFlag,
  markDeliberateLogout,
  SESSION_STORAGE_KEY,
  useSessionStore,
} from './session-store';

const SESSION = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'owner@example.com', displayName: 'مدیر فروشگاه' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه' },
  role: 'OWNER',
};

beforeEach(() => {
  localStorage.clear();
  useSessionStore.setState({ session: null });
  consumeDeliberateLogoutFlag(); // پرچم را از تست قبلی پاک کن
});

describe('session-store', () => {
  it('پیش‌فرض بدون نشست است', () => {
    expect(useSessionStore.getState().session).toBeNull();
  });

  it('setSession نشست را ذخیره می‌کند', () => {
    useSessionStore.getState().setSession(SESSION);
    expect(useSessionStore.getState().session).toEqual(SESSION);
  });

  it('clearSession نشست را پاک می‌کند', () => {
    useSessionStore.getState().setSession(SESSION);
    useSessionStore.getState().clearSession();
    expect(useSessionStore.getState().session).toBeNull();
  });
});

describe('session-store — persistence (FE-027)', () => {
  it('تغییر بلافاصله در localStorage نوشته می‌شود — رفرش صفحه نشست را از دست نمی‌دهد', () => {
    useSessionStore.getState().setSession(SESSION);

    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ state: { session: SESSION } });
  });

  it('خروج، localStorage را هم پاک می‌کند — تب دیگر هم می‌تواند رصدش کند', () => {
    useSessionStore.getState().setSession(SESSION);
    useSessionStore.getState().clearSession();

    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    expect(JSON.parse(raw ?? '{}')).toMatchObject({ state: { session: null } });
  });
});

describe('پرچم خروج عمدی (FE-027)', () => {
  it('پیش‌فرض false است', () => {
    expect(consumeDeliberateLogoutFlag()).toBe(false);
  });

  it('markDeliberateLogout پرچم را true می‌کند', () => {
    markDeliberateLogout();
    expect(consumeDeliberateLogoutFlag()).toBe(true);
  });

  it('خواندن، پرچم را مصرف می‌کند — بار دوم دوباره false است', () => {
    markDeliberateLogout();
    consumeDeliberateLogoutFlag();
    expect(consumeDeliberateLogoutFlag()).toBe(false);
  });
});
