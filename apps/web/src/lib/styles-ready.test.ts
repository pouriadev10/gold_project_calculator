import { afterEach, describe, expect, it } from 'vitest';
import { stylesheetsReady } from './styles-ready';

/** FE-088 — React پیش از رسیدن CSS غیرمسدودکننده رندر نمی‌کند. */

afterEach(() => {
  document.head.querySelectorAll('link').forEach((link) => link.remove());
});

function pendingStylesheet(): HTMLLinkElement {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/assets/index.css';
  // jsdom فایل را بار نمی‌کند؛ sheet تا رویداد load عمداً null می‌ماند
  Object.defineProperty(link, 'sheet', { configurable: true, value: null });
  document.head.append(link);
  return link;
}

describe('stylesheetsReady', () => {
  it('بدون stylesheet در انتظار (توسعه: CSS از <style>ِ Vite) فوراً آماده است', async () => {
    await expect(stylesheetsReady()).resolves.toBeUndefined();
  });

  it('تا load همه‌ی stylesheetهای در انتظار صبر می‌کند', async () => {
    const link = pendingStylesheet();
    let ready = false;
    void stylesheetsReady().then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);

    link.dispatchEvent(new Event('load'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ready).toBe(true);
  });

  it('شکست بار CSS هم برنامه را بالا می‌آورد', async () => {
    const link = pendingStylesheet();
    const ready = stylesheetsReady();
    link.dispatchEvent(new Event('error'));
    await expect(ready).resolves.toBeUndefined();
  });
});
