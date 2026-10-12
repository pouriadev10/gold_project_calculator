import type { Plugin } from 'vite';

/**
 * CSS اصلی بدون مسدود کردن اولین رنگ‌آمیزی — FE-088.
 *
 * `<link rel="stylesheet">` معمولی رنگ‌آمیزی را تا رسیدن فایل نگه می‌دارد؛ یعنی پوسته‌ی
 * inline `index.html` (که خودش استایل inline دارد و به این فایل نیازی ندارد) روی 3G یک
 * رفت‌وبرگشت کامل دیرتر دیده می‌شد. با ترفند استاندارد `media="print"` + `onload`
 * رنگ‌آمیزی منتظر فایل نمی‌ماند.
 *
 * ولی stylesheet با `media="print"` پایین‌ترین اولویت شبکه را می‌گیرد و Chrome روی
 * HTTP/1.1 ممکن است تا تمام شدن درخواست‌های مهم‌تر نگهش دارد — در حالی که React بدون آن
 * رندر نمی‌کند. پس یک `<link rel="preload" as="style">` هم کنارش می‌آید تا فایل با
 * اولویت بالا و هم‌زمان با بسته‌ی JS دانلود شود.
 *
 * React پیش از رسیدن این CSS هرگز رندر نمی‌کند: `main.tsx` با `stylesheetsReady()`
 * منتظرش می‌ماند، پس هیچ لحظه‌ی بی‌استایلی (FOUC) از خودِ برنامه دیده نمی‌شود.
 */
export function toNonBlockingStylesheets(html: string): string {
  return html.replace(/<link rel="stylesheet"((?:(?!media=)[^>])*?)>/gu, (_tag, attributes: string) => {
    return (
      `<link rel="preload" as="style"${attributes}>` +
      `<link rel="stylesheet"${attributes} media="print" onload="this.media='all'">`
    );
  });
}

export function nonBlockingCss(): Plugin {
  return {
    name: 'gold:non-blocking-css',
    apply: 'build',
    transformIndexHtml: { order: 'post', handler: toNonBlockingStylesheets },
  };
}
