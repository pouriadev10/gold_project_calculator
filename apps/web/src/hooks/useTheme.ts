import { useEffect } from 'react';
import { applyTheme, subscribeToSystemTheme } from '@/lib/theme';
import { useThemeStore } from '@/stores/theme-store';

/**
 * پوسته را با استور همگام نگه می‌دارد.
 *
 * یک بار در ریشه‌ی برنامه صدا زده می‌شود. وقتی حالت `system` است، به
 * تغییر تنظیم دستگاه هم گوش می‌دهد — کاربر ممکن است وسط کار گوشی را به
 * حالت شب ببرد و برنامه باید همان لحظه همراه شود، نه بعد از بارگذاری بعدی.
 */
export function useTheme(): void {
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    applyTheme(theme);

    if (theme !== 'system') return;
    return subscribeToSystemTheme(() => applyTheme('system'));
  }, [theme]);
}
