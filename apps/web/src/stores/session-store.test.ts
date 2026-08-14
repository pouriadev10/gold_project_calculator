import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from './session-store';

const SESSION = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'owner@example.com', displayName: 'مدیر فروشگاه' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه' },
  role: 'OWNER',
};

beforeEach(() => {
  useSessionStore.setState({ session: null });
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
