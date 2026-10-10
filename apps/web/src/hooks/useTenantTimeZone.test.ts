import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionResponse } from '@/api/contracts';
import { useSessionStore } from '@/stores/session-store';
import { resolveTenantTimeZone, useTenantTimeZone } from './useTenantTimeZone';

/** FE-071 — منطقه‌ی زمانی مستأجر از نشست. */

const DEVICE_TIME_ZONE = new Intl.DateTimeFormat().resolvedOptions().timeZone;

function session(timezone: string): SessionResponse {
  return {
    accessToken: 'a',
    refreshToken: 'r',
    expiresInSeconds: 900,
    user: { id: 'u1', email: 'owner@example.com', displayName: 'مالک' },
    tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone },
    role: 'OWNER',
  };
}

afterEach(() => {
  useSessionStore.setState({ session: null });
});

describe('useTenantTimeZone', () => {
  it('منطقه‌ی مستأجر را از نشست می‌خواند', () => {
    useSessionStore.setState({ session: session('America/New_York') });
    const { result } = renderHook(() => useTenantTimeZone());
    expect(result.current).toBe('America/New_York');
  });

  it('فقط برای نشست قدیمی بی‌فیلد یا نام نامعتبر به منطقه‌ی دستگاه برمی‌گردد', () => {
    expect(resolveTenantTimeZone('Asia/Tehran')).toBe('Asia/Tehran');
    expect(resolveTenantTimeZone(undefined)).toBe(DEVICE_TIME_ZONE);
    expect(resolveTenantTimeZone('Not/AZone')).toBe(DEVICE_TIME_ZONE);

    // نشست ذخیره‌شده پیش از FE-071 در localStorage این فیلد را ندارد.
    const legacy = session('x');
    useSessionStore.setState({
      session: { ...legacy, tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه' } } as SessionResponse,
    });
    const { result } = renderHook(() => useTenantTimeZone());
    expect(result.current).toBe(DEVICE_TIME_ZONE);
  });
});
