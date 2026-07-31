import type { ResolvedTheme, ThemeMode } from '@/stores/theme-store';

/**
 * اعمال پوسته روی DOM.
 *
 * جدا از استور نگه داشته شده تا بدون رندر هیچ کامپوننتی قابل تست باشد.
 */

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** پرس‌وجوی رسانه‌ای — در محیط تست ممکن است وجود نداشته باشد. */
function prefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** `system` را به پوسته‌ی واقعی تبدیل می‌کند. */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return prefersDark() ? 'dark' : 'light';
  return mode;
}

/**
 * کلاس `dark` را روی ریشه می‌گذارد یا برمی‌دارد و رنگ نوار مرورگر را
 * هماهنگ می‌کند.
 *
 * رنگ نوار از **خود توکن** `--background` خوانده می‌شود، نه از یک ثابت
 * جداگانه. اگر پالت عوض شود، نوار مرورگر خودبه‌خود همراهش می‌آید و
 * هیچ رنگ hex خامی هم در کد نمی‌ماند.
 */
export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  const root = document.documentElement;

  root.classList.toggle('dark', resolved === 'dark');

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const background = getComputedStyle(root).getPropertyValue('--background').trim();
    if (background) meta.setAttribute('content', `hsl(${background})`);
  }

  return resolved;
}

/** اشتراک در تغییر تنظیم سیستم. فقط وقتی معنا دارد که حالت `system` باشد. */
export function subscribeToSystemTheme(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};

  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
