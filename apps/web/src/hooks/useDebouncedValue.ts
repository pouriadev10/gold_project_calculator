import { useEffect, useState } from 'react';

/**
 * مقدار را با تأخیر منتشر می‌کند — برای جست‌وجوی زنده (FE-032) که نباید
 * روی هر ضربه‌ی کیبورد یک درخواست تازه بسازد.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
