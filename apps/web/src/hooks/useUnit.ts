import { useEffect } from 'react';
import { UNIT_STORAGE_KEY, useUnitStore } from '@/stores/unit-store';

/**
 * واحد نمایش را بین تب‌های باز مرورگر همگام نگه می‌دارد.
 *
 * `persist` زوستند فقط تب فعال را بلافاصله به‌روز می‌کند و به رویداد بومی
 * `storage` گوش نمی‌دهد. بدون این هوک، کاربری که دو تب باز دارد بعد از
 * تغییر واحد در یکی، در تب دیگر تا رفرش عدد قدیمی را می‌بیند — دقیقاً
 * همان مغایرتی که قاعده‌ی ۲-۴ CLAUDE.md می‌خواهد نباشد.
 *
 * یک بار در ریشه‌ی برنامه صدا زده می‌شود، کنار `useTheme`.
 */
export function useUnit(): void {
  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== UNIT_STORAGE_KEY) return;
      void useUnitStore.persist.rehydrate();
    }

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);
}
