import { create } from 'zustand';
import type { SessionResponse } from '@/api/contracts';

/**
 * نشست جاری — حداقلی، فقط برای FE-026.
 *
 * عمداً **بدون** `persist`: محل امن نگهداری توکن (کجا، با چه استراتژی
 * تمدید، همگام‌سازی بین تب‌ها) تصمیم FE-027 است، نه این تسک. این استور
 * فقط همان چیزی را می‌دهد که برای «ورود موفق مسیر را عوض کند» لازم است —
 * وگرنه یک تصمیم ذخیره‌سازی زودهنگام و ناقص اینجا قفل می‌شد که FE-027
 * باید بعداً نصفه‌کاره بازش کند.
 */
interface SessionState {
  session: SessionResponse | null;
  setSession: (session: SessionResponse) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  setSession: (session) => set({ session }),
  clearSession: () => set({ session: null }),
}));
