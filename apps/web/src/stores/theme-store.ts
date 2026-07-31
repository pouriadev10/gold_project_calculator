import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * پوسته‌ی ظاهری.
 *
 * `system` پیش‌فرض است، نه `light` یا `dark`: کاربر تنظیم دستگاهش را
 * یک بار انجام داده و انتظار دارد برنامه از آن پیروی کند. هر دو حالت
 * دیگر بازنویسی صریح کاربرند و بر تنظیم سیستم مقدم‌اند.
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** پوسته‌ی نهایی پس از حل‌شدن `system`. */
export type ResolvedTheme = 'light' | 'dark';

interface ThemeState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
}

/**
 * کلید `localStorage` عمداً با اسکریپت درون‌خطی `index.html` مشترک است.
 * آن اسکریپت پیش از اولین رنگ‌آمیزی همین مقدار را می‌خواند تا صفحه با
 * پوسته‌ی اشتباه بالا نیاید. اگر این کلید یا ساختارش عوض شود، آن اسکریپت
 * هم باید عوض شود — وگرنه یک پرش سفید در حالت تاریک برمی‌گردد.
 */
export const THEME_STORAGE_KEY = 'gold-ui-theme';

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    { name: THEME_STORAGE_KEY },
  ),
);

export const THEME_TITLE: Record<ThemeMode, string> = {
  light: 'روشن',
  dark: 'تیره',
  system: 'سیستم',
};
