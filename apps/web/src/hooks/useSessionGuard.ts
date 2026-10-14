import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { setUnauthorizedHandler } from '@/api/query-client';
import { clearTenantData } from '@/lib/tenant-data';
import {
  consumeDeliberateLogoutFlag,
  SESSION_STORAGE_KEY,
  useSessionStore,
} from '@/stores/session-store';

/**
 * نگهبان نشست — FE-027.
 *
 * سه کار می‌کند، هر سه واکنشی به «نشست فعال به null رفت»، نه یک تایمر
 * پیش‌دستانه: تایمر می‌تواند با ساعت سیستم یا تب معلق‌شده جفت‌نشدنی شود؛
 * واکنش به ۴۰۱ واقعی (که `client.ts` می‌سازد) همیشه درست است.
 *
 * ۱. **همگام‌سازی بین تب‌ها.** `persist` فقط تب فعال را به‌روز می‌کند؛
 *    بدون این، تبی که در آن خروج زده نشده هنوز نشست باطل‌شده را معتبر
 *    می‌پندارد.
 * ۲. **واکنش به مرگ نشست.** `client.ts` وقتی تمدید هم شکست بخورد
 *    `clearSession()` را خودش صدا می‌زند (مسیر معمول). این هوک آن گذار
 *    را می‌بیند و کش TanStack Query را پاک و به `/login` هدایت می‌کند.
 * ۳. **اتصال قلاب FE-009.** `setUnauthorizedHandler` نقطه‌ای است که
 *    `query-client.ts` از قبل برای FE-027 آماده کرده بود — برای فراخوانی
 *    مستقیمی که (فرضاً در آینده) از مسیر `client.ts` عبور نکند.
 *
 * **خروج عمدی همه‌ی داده‌ی مستأجر را پاک می‌کند** (FE-101، `clearTenantData`): کش، پیش‌نویس‌ها،
 * اشخاص و کالاهای اخیر، تلاش‌های ثبت و toastها. انقضای نشست فقط کش را پاک می‌کند — همان کاربر پس
 * از ورود دوباره پیش‌نویسش را می‌خواهد؛ اگر کاربر یا مستأجر دیگری وارد شود، `claimTenantData` در
 * صفحه‌ی ورود بقیه را پاک می‌کند.
 *
 * فقط به **گذار** فعال→null واکنش می‌دهد، نه به null بودن در mount اول:
 * تا وقتی FE-028 (Route Guard) نیست، صفحه‌ای که هنوز کسی وارد نشده هم
 * باید بدون نشست قابل دیدن بماند، نه بی‌دلیل به ورود پرتاب شود.
 */
export function useSessionGuard(): void {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hadSession = useRef(useSessionStore.getState().session !== null);

  useEffect(() => {
    setUnauthorizedHandler(() => useSessionStore.getState().clearSession());
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== SESSION_STORAGE_KEY) return;
      void useSessionStore.persist.rehydrate();
    }

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(
    () =>
      useSessionStore.subscribe((state) => {
        const hasSession = state.session !== null;

        if (!hasSession && hadSession.current) {
          const deliberate = consumeDeliberateLogoutFlag();
          if (deliberate) clearTenantData(queryClient);
          else queryClient.clear();
          void navigate({ to: '/login', search: deliberate ? {} : { reason: 'expired' } });
        }

        hadSession.current = hasSession;
      }),
    [navigate, queryClient],
  );
}
