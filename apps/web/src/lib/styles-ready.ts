/**
 * تا همه‌ی stylesheetهای `<link>` سند بار شوند صبر می‌کند — FE-088.
 *
 * CSS اصلی در production غیرمسدودکننده است (`vite-plugins/non-blocking-css.ts`)، پس
 * ممکن است بسته‌ی JS زودتر برسد. رندر React باید منتظر بماند وگرنه یک لحظه برنامه‌ی
 * بی‌استایل دیده می‌شود. در توسعه CSS از راه `<style>`ِ Vite می‌آید و چیزی برای صبر نیست.
 *
 * شکست بار CSS هم «آماده» حساب می‌شود: برنامه‌ی زشت بهتر از برنامه‌ی بالا‌نیامده است.
 */
export function stylesheetsReady(doc: Document = document): Promise<void> {
  const pending = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).filter(
    (link) => link.sheet === null,
  );
  return Promise.all(
    pending.map(
      (link) =>
        new Promise<void>((resolve) => {
          link.addEventListener('load', () => resolve(), { once: true });
          link.addEventListener('error', () => resolve(), { once: true });
        }),
    ),
  ).then(() => undefined);
}
