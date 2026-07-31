import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, resolveTheme } from '@/lib/theme';
import { useThemeStore } from '@/stores/theme-store';
import { ThemeToggle } from './ThemeToggle';

/**
 * تنظیم `prefers-color-scheme` شبیه‌سازی می‌شود، چون jsdom خودش
 * `matchMedia` ندارد و بدون آن حالت `system` قابل آزمون نیست.
 */
function mockSystemDark(isDark: boolean) {
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('dark') && isDark,
      media: query,
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      dispatchEvent: () => false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    })),
  );
  return listeners;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  useThemeStore.setState({ theme: 'system' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveTheme', () => {
  it('حالت صریح کاربر بر تنظیم سیستم مقدم است', () => {
    mockSystemDark(true);
    expect(resolveTheme('light')).toBe('light');
    mockSystemDark(false);
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('حالت system از تنظیم دستگاه پیروی می‌کند', () => {
    mockSystemDark(true);
    expect(resolveTheme('system')).toBe('dark');
    mockSystemDark(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('نبودن matchMedia باعث خطا نمی‌شود و به روشن برمی‌گردد', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(resolveTheme('system')).toBe('light');
  });
});

describe('applyTheme', () => {
  it('کلاس dark را روی ریشه می‌گذارد و برمی‌دارد', () => {
    mockSystemDark(false);

    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('پوسته‌ی حل‌شده را برمی‌گرداند', () => {
    mockSystemDark(true);
    expect(applyTheme('system')).toBe('dark');
  });

  it('رنگ نوار مرورگر را از توکن پس‌زمینه می‌خواند، نه از ثابت جداگانه', () => {
    mockSystemDark(false);
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', 'placeholder');
    document.head.appendChild(meta);

    document.documentElement.style.setProperty('--background', '24 10% 8%');
    applyTheme('dark');

    expect(meta.getAttribute('content')).toBe('hsl(24 10% 8%)');
    meta.remove();
    document.documentElement.style.removeProperty('--background');
  });
});

describe('ThemeToggle', () => {
  it('هر سه حالت را نشان می‌دهد', () => {
    mockSystemDark(false);
    render(<ThemeToggle />);
    expect(screen.getByRole('radio', { name: 'روشن' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'تیره' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'سیستم' })).toBeInTheDocument();
  });

  it('پیش‌فرض «سیستم» است — نه روشن، نه تیره', () => {
    mockSystemDark(false);
    render(<ThemeToggle />);
    expect(screen.getByRole('radio', { name: 'سیستم' })).toHaveAttribute('aria-checked', 'true');
  });

  it('انتخاب کاربر در استور و localStorage می‌ماند', async () => {
    mockSystemDark(false);
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('radio', { name: 'تیره' }));

    expect(useThemeStore.getState().theme).toBe('dark');
    expect(localStorage.getItem('gold-ui-theme')).toContain('dark');
  });

  it('حالت فعال با aria-checked اعلام می‌شود، نه فقط با رنگ', async () => {
    mockSystemDark(false);
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('radio', { name: 'روشن' }));

    expect(screen.getByRole('radio', { name: 'روشن' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'تیره' })).toHaveAttribute('aria-checked', 'false');
  });

  it('هر سه هدف لمسی حداقل ۴۴ پیکسل ارتفاع دارند', () => {
    mockSystemDark(false);
    render(<ThemeToggle />);
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.className).toContain('min-h-touch');
    }
  });
});

describe('کلید ضدپرش در index.html', () => {
  it('کلید localStorage با استور یکی است — اگر فرق کند، پرش سفید برمی‌گردد', async () => {
    mockSystemDark(false);
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.click(screen.getByRole('radio', { name: 'تیره' }));

    // همان شکلی که اسکریپت درون‌خطی می‌خواند: JSON.parse(raw).state.theme
    const raw = localStorage.getItem('gold-ui-theme');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).state.theme).toBe('dark');
  });
});
