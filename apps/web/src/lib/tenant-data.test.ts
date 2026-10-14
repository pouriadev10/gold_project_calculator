import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@/api/contracts';
import { SUBMIT_ATTEMPT_STORAGE_PREFIX } from '@/lib/submit-attempt-storage';
import { useRecentJewelryItemsStore } from '@/stores/recent-jewelry-items-store';
import { useRecentPartiesStore } from '@/stores/recent-parties-store';
import { claimTenantData, clearTenantData, DATA_OWNER_STORAGE_KEY } from './tenant-data';

const SESSION: SessionResponse = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'u@example.com', displayName: 'کاربر' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری', timezone: 'Asia/Tehran' },
  role: 'OWNER',
};
const PARTY = { id: 'p1', displayName: 'مشتری', mobile: null, type: 'CONSUMER', status: 'ACTIVE' } as const;

function seededClient(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(['parties', 'list'], { items: [PARTY] });
  return client;
}

beforeEach(() => {
  localStorage.removeItem(DATA_OWNER_STORAGE_KEY);
  useRecentPartiesStore.setState({ recent: [PARTY] });
});
afterEach(() => {
  vi.restoreAllMocks();
  useRecentPartiesStore.getState().clear();
});

describe('clearTenantData', () => {
  it('کش، فهرست‌های اخیر و تلاش‌های ثبت را پاک می‌کند', () => {
    const client = seededClient();
    useRecentJewelryItemsStore.setState({ recent: [] });
    sessionStorage.setItem(`${SUBMIT_ATTEMPT_STORAGE_PREFIX}t1:u1:x`, '{}');

    clearTenantData(client);

    expect(client.getQueryData(['parties', 'list'])).toBeUndefined();
    expect(useRecentPartiesStore.getState().recent).toEqual([]);
    expect(sessionStorage.getItem(`${SUBMIT_ATTEMPT_STORAGE_PREFIX}t1:u1:x`)).toBeNull();
  });

  it('storage ِ مسدود پاک‌سازی بقیه را متوقف نمی‌کند', () => {
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    const client = seededClient();

    expect(() => clearTenantData(client)).not.toThrow();
    expect(client.getQueryData(['parties', 'list'])).toBeUndefined();
    expect(useRecentPartiesStore.getState().recent).toEqual([]);
  });
});

describe('claimTenantData', () => {
  it('همان مالک: چیزی پاک نمی‌شود', () => {
    localStorage.setItem(DATA_OWNER_STORAGE_KEY, 't1:u1');
    const client = seededClient();
    claimTenantData(SESSION, client);
    expect(client.getQueryData(['parties', 'list'])).toBeDefined();
    expect(useRecentPartiesStore.getState().recent).toEqual([PARTY]);
  });

  it.each([
    ['مستأجر دیگر', 't2:u1'],
    ['کاربر دیگر در همان مستأجر', 't1:u2'],
    ['مالک نامعلوم', null],
  ])('%s: همه پاک و مالک تازه ثبت می‌شود', (_label, previous) => {
    if (previous !== null) localStorage.setItem(DATA_OWNER_STORAGE_KEY, previous);
    const client = seededClient();
    claimTenantData(SESSION, client);
    expect(client.getQueryData(['parties', 'list'])).toBeUndefined();
    expect(useRecentPartiesStore.getState().recent).toEqual([]);
    expect(localStorage.getItem(DATA_OWNER_STORAGE_KEY)).toBe('t1:u1');
  });
});
