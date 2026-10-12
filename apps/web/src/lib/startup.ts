import type { QueryClient } from '@tanstack/react-query';

/**
 * زمان‌بندی کارهای «پس از بالا آمدن» — FE-088.
 *
 * روی 3G هر بایتی که هم‌زمان با بسته‌ی JS، چانک مسیر و پاسخ‌های API صفحه‌ی اول دانلود
 * شود، محتوای LCP را عقب می‌اندازد. کارهایی که برای اولین صفحه لازم نیستند (فونت در
 * بار اول، ثبت سرویس‌ورکر و precache حدود ۱٫۵MB آن) تا این لحظه صبر می‌کنند.
 */

/** سقف انتظار — اگر یک درخواست گیر کرد، کارهای پس از بالا آمدن تا ابد عقب نمی‌مانند. */
export const STARTUP_MAX_WAIT_MS = 4000;

/**
 * وقتی هیچ query در حال دریافت نیست، یا حداکثر پس از `maxWaitMs`.
 *
 * queryهای صفحه‌ی اول در effectهای پس از اولین commit شروع می‌شوند؛ پس بررسی پس از
 * یک فریم و یک macrotask انجام می‌شود، نه بلافاصله (وگرنه «هیچ چیز در حال دریافت
 * نیست» پیش از شروعشان درست به نظر می‌رسید). در تب پنهان که فریمی کشیده نمی‌شود،
 * همان سقف زمانی کار را تمام می‌کند.
 */
export function whenStartupQueriesSettle(client: QueryClient, maxWaitMs = STARTUP_MAX_WAIT_MS): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    let unsubscribe: (() => void) | undefined;
    const finish = () => {
      if (finished) return;
      finished = true;
      unsubscribe?.();
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, maxWaitMs);
    const start = () => {
      if (finished) return;
      if (client.isFetching() === 0) {
        finish();
        return;
      }
      unsubscribe = client.getQueryCache().subscribe(() => {
        if (client.isFetching() === 0) finish();
      });
    };
    requestAnimationFrame(() => setTimeout(start, 0));
  });
}

/** سقف انتظار برای گزارش رنگ‌آمیزی محتوای تازه؛ اگر داده عنصر بزرگ‌تری نساخت، گزارشی نمی‌آید. */
export const CONTENT_PAINT_MAX_WAIT_MS = 600;

/**
 * پس از اینکه مرورگر محتوای تازه را واقعاً کشید، یا حداکثر `maxWaitMs`.
 *
 * وقتی queryها نشستند، React هنوز داده را نکشیده (رندر و چیدمان روی گوشی ارزان صدها
 * میلی‌ثانیه است). خودِ مرورگر با ورودی `largest-contentful-paint` خبر می‌دهد که
 * بزرگ‌ترین محتوای تازه کی روی صفحه آمد؛ هر ورودی پس از `since` یعنی داده‌ی صفحه
 * کشیده شده. مرورگری که این گزارش را ندارد (Safari) به یک فریم بسنده می‌کند.
 */
export function afterContentPaint(since: number, maxWaitMs = CONTENT_PAINT_MAX_WAIT_MS): Promise<void> {
  return new Promise((resolve) => {
    const supported =
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes?.includes('largest-contentful-paint') === true;
    if (!supported) {
      requestAnimationFrame(() => setTimeout(resolve, 0));
      return;
    }
    const observer = new PerformanceObserver((list) => {
      if (list.getEntries().some((entry) => entry.startTime >= since)) finish();
    });
    const timer = setTimeout(finish, maxWaitMs);
    function finish() {
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    }
    observer.observe({ type: 'largest-contentful-paint', buffered: true });
  });
}

/** یک لحظه‌ی بیکاری مرورگر (حداکثر `timeoutMs`). */
export function whenIdle(timeoutMs = 1000): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => resolve(), { timeout: timeoutMs });
    } else {
      // Safari هنوز requestIdleCallback ندارد
      setTimeout(resolve, 50);
    }
  });
}

/**
 * «بالا آمدن تمام شد»: داده‌ی صفحه‌ی اول رسید، کشیده شد و مرورگر نفسی کشید. فقط کارهای
 * جانبی (فونت بار اول، سرویس‌ورکر، رندرکننده‌ی toast) منتظر این‌اند — هرگز محتوای صفحه.
 */
export async function afterStartup(client: QueryClient): Promise<void> {
  await whenStartupQueriesSettle(client);
  await afterContentPaint(performance.now());
  await whenIdle();
}

/**
 * ثبت سرویس‌ورکر — همان کاری که `registerSW.js`ِ vite-plugin-pwa می‌کرد، منهای دو
 * هزینه‌اش: آن فایل یک `<script>` همگام در `<head>` بود (درخواست مسدودکننده‌ی تجزیه‌ی
 * HTML) و ثبت را به رویداد `load` می‌بست که روی 3G درست وسط دریافت داده‌ی صفحه‌ی اول
 * است. اعلان به‌روزرسانی و رفتار PWA کامل کار FE-090 است.
 */
export function registerServiceWorker(base: string): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
    // بدون سرویس‌ورکر برنامه همچنان کار می‌کند؛ فقط بازدید بعدی از کش نمی‌آید
  });
}
