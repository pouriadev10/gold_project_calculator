import { useCallback, useState } from 'react';
import { logout as logoutRequest } from '@/api/auth';
import { markDeliberateLogout, useSessionStore } from '@/stores/session-store';

/**
 * خروج کاربر — FE-027.
 *
 * فراخوانی سرور «تلاش با بهترین کوشش» است: اگر شبکه قطع باشد یا پاسخ
 * ندهد، کاربر همچنان محلی خارج می‌شود. کسی که روی «خروج» زده، خروج را
 * می‌خواهد صرف‌نظر از وضعیت شبکه — منتظر ماندن یا رد کردن خروج به‌خاطر
 * یک درخواست ناموفق فقط قفلش می‌کند.
 *
 * `clearSession()` گذار نشست را می‌سازد که `useSessionGuard` می‌بیند و
 * کش را پاک و به `/login` می‌فرستد؛ این هوک خودش navigate نمی‌کند تا
 * دو منبع ناوبری همزمان نداشته باشیم.
 */
export function useLogout(): { readonly logout: () => Promise<void>; readonly isLoggingOut: boolean } {
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const logout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      const refreshToken = useSessionStore.getState().session?.refreshToken;
      if (refreshToken) {
        try {
          await logoutRequest(refreshToken);
        } catch {
          // بهترین کوشش — خروج محلی صرف‌نظر از نتیجه‌ی شبکه ادامه می‌یابد
        }
      }
      markDeliberateLogout();
      useSessionStore.getState().clearSession();
    } finally {
      setIsLoggingOut(false);
    }
  }, []);

  return { logout, isLoggingOut };
}
