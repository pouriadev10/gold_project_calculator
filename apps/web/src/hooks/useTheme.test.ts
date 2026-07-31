import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeStore } from '@/stores/theme-store';
import { useTheme } from './useTheme';

/**
 * مسیر «تغییر زنده‌ی تنظیم سیستم».
 *
 * این رفتار را نمی‌شود در مرورگر آزمود: شبیه‌سازی `prefers-color-scheme`
 * از طریق CDP رویداد `change` را روی media query منتشر نمی‌کند. پس اینجا
 * یک `matchMedia` با شنونده‌ی واقعی می‌سازیم و خودمان رویداد را می‌زنیم.
 */
function installMatchMedia(initialDark: boolean) {
  const state = { dark: initialDark };
  const listeners = new Set<() => void>();

  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return query.includes('dark') && state.dark;
      },
      media: query,
      addEventListener: (_type: string, cb: () => void) => {
        listeners.add(cb);
      },
      removeEventListener: (_type: string, cb: () => void) => {
        listeners.delete(cb);
      },
      dispatchEvent: () => false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    })),
  );

  return {
    setDark(next: boolean) {
      state.dark = next;
      for (const cb of listeners) cb();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  useThemeStore.setState({ theme: 'system' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useTheme', () => {
  it('در حالت system، تغییر تنظیم دستگاه بلافاصله اعمال می‌شود', () => {
    const mq = installMatchMedia(false);
    renderHook(() => useTheme());

    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // کاربر وسط کار گوشی را به حالت شب می‌برد
    act(() => mq.setDark(true));
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    act(() => mq.setDark(false));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('در حالت صریح، تغییر تنظیم دستگاه نادیده گرفته می‌شود', () => {
    const mq = installMatchMedia(false);
    useThemeStore.setState({ theme: 'light' });
    renderHook(() => useTheme());

    act(() => mq.setDark(true));

    // انتخاب صریح کاربر برنده است
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(mq.listenerCount).toBe(0);
  });

  it('با unmount شنونده پاک می‌شود — نشت رویداد نمی‌ماند', () => {
    const mq = installMatchMedia(false);
    const { unmount } = renderHook(() => useTheme());

    expect(mq.listenerCount).toBe(1);
    unmount();
    expect(mq.listenerCount).toBe(0);
  });

  it('تغییر حالت در استور فوراً روی DOM می‌نشیند', () => {
    installMatchMedia(false);
    renderHook(() => useTheme());

    act(() => useThemeStore.getState().setTheme('dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    act(() => useThemeStore.getState().setTheme('light'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
