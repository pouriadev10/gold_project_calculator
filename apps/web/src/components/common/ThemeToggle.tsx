import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { THEME_TITLE, useThemeStore, type ThemeMode } from '@/stores/theme-store';

/**
 * کلید پوسته — روشن / تیره / سیستم.
 *
 * سه‌حالته است، نه دوحالته: «سیستم» یک انتخاب مستقل است، نه نبودِ انتخاب.
 * با کلید دوحالته کاربری که تنظیم شبانه‌ی گوشی‌اش را می‌خواهد، مجبور
 * می‌شود هر روز دستی عوض کند.
 */

const OPTIONS: ReadonlyArray<{ value: ThemeMode; icon: typeof Sun }> = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  return (
    <div
      role="radiogroup"
      aria-label="پوسته‌ی ظاهری"
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border border-border bg-muted p-1',
        className,
      )}
    >
      {OPTIONS.map(({ value, icon: Icon }) => {
        const isActive = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={THEME_TITLE[value]}
            onClick={() => setTheme(value)}
            className={cn(
              'inline-flex min-h-touch cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              isActive
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground active:bg-card/60',
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {THEME_TITLE[value]}
          </button>
        );
      })}
    </div>
  );
}
