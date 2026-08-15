import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNIT_STORAGE_KEY, useUnitStore } from '@/stores/unit-store';
import { useUnit } from './useUnit';

beforeEach(() => {
  localStorage.clear();
  useUnitStore.setState({ unit: 'gold' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useUnit', () => {
  it('رویداد storage با کلید واحد، state را از تب دیگر rehydrate می‌کند', async () => {
    renderHook(() => useUnit());

    // شبیه‌سازی تبی دیگر که واحد را عوض کرده: مستقیم در localStorage
    // می‌نویسیم (نه از طریق setUnit همین تب) تا رویداد بومی مرورگر شبیه‌سازی شود.
    localStorage.setItem(UNIT_STORAGE_KEY, JSON.stringify({ state: { unit: 'rial' }, version: 0 }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: UNIT_STORAGE_KEY }));
    });

    await waitFor(() => {
      expect(useUnitStore.getState().unit).toBe('rial');
    });
  });

  it('رویداد storage با کلید نامرتبط را نادیده می‌گیرد', async () => {
    renderHook(() => useUnit());

    localStorage.setItem('some-other-key', JSON.stringify({ state: { unit: 'rial' }, version: 0 }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'some-other-key' }));
    });

    // فرصت به هر microtask احتمالی بده، بعد مطمئن شو چیزی عوض نشده
    await Promise.resolve();
    expect(useUnitStore.getState().unit).toBe('gold');
  });

  it('با unmount شنونده پاک می‌شود — نشت رویداد نمی‌ماند', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useUnit());
    const [, handler] = addSpy.mock.calls.find(([type]) => type === 'storage') ?? [];
    expect(handler).toBeDefined();

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('storage', handler);
  });
});
