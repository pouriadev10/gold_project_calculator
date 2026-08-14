import { useCallback, useSyncExternalStore } from 'react';

/**
 * وضعیت زنده‌ی یک media query.
 *
 * از `useSyncExternalStore` استفاده می‌کند تا با چرخش دستگاه یا تغییر
 * اندازه‌ی پنجره فوراً دوباره‌رندر شود، نه فقط یک‌بار در mount خوانده شود.
 * در محیط تست (jsdom) که `matchMedia` پیاده‌سازی نشده، به `false` برمی‌گردد؛
 * تست‌ها با `vi.stubGlobal('matchMedia', ...)` آن را شبیه‌سازی می‌کنند —
 * همان الگویی که `lib/theme.ts` برای `prefers-color-scheme` استفاده می‌کند.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    [query],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
