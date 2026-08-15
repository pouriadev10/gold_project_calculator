import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from './useMediaQuery';

/** شبیه‌سازی `matchMedia` با قابلیت تغییر مقدار و اطلاع به listenerها. */
function mockMatchMedia(initialMatches: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  let matches = initialMatches;

  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_: string, cb: (event: { matches: boolean }) => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: (event: { matches: boolean }) => void) => listeners.delete(cb),
      dispatchEvent: () => false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    })),
  );

  return {
    setMatches(next: boolean) {
      matches = next;
      for (const cb of listeners) cb({ matches: next });
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMediaQuery', () => {
  it('مقدار اولیه‌ی تطبیق را برمی‌گرداند', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(min-width: 640px)'));
    expect(result.current).toBe(true);
  });

  it('با رویداد change صفحه دوباره‌رندر می‌شود', () => {
    const media = mockMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 640px)'));
    expect(result.current).toBe(false);

    act(() => media.setMatches(true));
    expect(result.current).toBe(true);

    act(() => media.setMatches(false));
    expect(result.current).toBe(false);
  });

  it('نبودن matchMedia باعث خطا نمی‌شود و false برمی‌گرداند', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useMediaQuery('(min-width: 640px)'));
    expect(result.current).toBe(false);
  });

  it('تغییر خودِ query هم دوباره اشتراک می‌سازد', () => {
    mockMatchMedia(true);
    const { result, rerender } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: '(min-width: 640px)' },
    });
    expect(result.current).toBe(true);

    mockMatchMedia(false);
    rerender({ query: '(min-width: 1024px)' });
    expect(result.current).toBe(false);
  });
});
