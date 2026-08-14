import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SessionResponse } from '@/api/contracts';

/**
 * نشست جاری — FE-026/FE-027.
 *
 * برخلاف نسخه‌ی اولیه‌ی FE-026، حالا `persist` دارد (localStorage). دو
 * قابلیت اجباری FE-027 بدون این ممکن نیستند: «انقضای access token بدون
 * از دست رفتن صفحه» (رفرش صفحه نباید کاربر را بیرون بیندازد) و
 * «همگام‌سازی logout بین تب‌ها» (فقط با یک منبع مشترک قابل مشاهده‌ست).
 *
 * این یعنی توکن‌ها در localStorage قابل‌خواندن‌اند — همان مصالحه‌ی ذاتی
 * هر SPA که توکن را در بدنه‌ی JSON می‌گیرد، نه کوکی httpOnly. کوکی
 * httpOnly امن‌تر است ولی نیازمند تغییر شکل پاسخ بک‌اند است؛ خارج از
 * دامنه‌ی یک تسک فرانت‌اند.
 */
export const SESSION_STORAGE_KEY = 'gold-ui-session';

interface SessionState {
  session: SessionResponse | null;
  setSession: (session: SessionResponse) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      session: null,
      setSession: (session) => set({ session }),
      clearSession: () => set({ session: null }),
    }),
    { name: SESSION_STORAGE_KEY },
  ),
);

/**
 * پرچم موقت و درون‌حافظه‌ای (نه بخشی از state استور) — آیا آخرین
 * پاک‌شدن نشست با کلیک کاربر روی «خروج» بوده؟
 *
 * `useSessionGuard` برای تفکیک پیام «شما خارج شدید» از «نشست منقضی شد»
 * از آن استفاده می‌کند. فقط همین تب را می‌بیند: تب‌های دیگر با رویداد
 * `storage` نشست را همگام می‌کنند ولی این پرچم بین تب‌ها منتقل نمی‌شود،
 * پس در آن‌ها پیام عمومی‌تر «منقضی شد» می‌ماند — نادقیق برای آن حالت
 * خاص، ولی همچنان درست (کاربر واقعاً دیگر وارد نیست).
 */
let deliberateLogout = false;

export function markDeliberateLogout(): void {
  deliberateLogout = true;
}

export function consumeDeliberateLogoutFlag(): boolean {
  const value = deliberateLogout;
  deliberateLogout = false;
  return value;
}
