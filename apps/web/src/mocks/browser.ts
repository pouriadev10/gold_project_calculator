import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/**
 * سرویس‌ورکر ساختگی — **فقط توسعه**.
 *
 * این ماژول عمداً هیچ‌جا به‌صورت ایستا `import` نمی‌شود. تنها مسیر
 * رسیدن به آن یک `import()` پویا در `main.tsx` است که داخل شرط
 * `import.meta.env.DEV` نشسته. در بیلد production آن شرط به `false`
 * تبدیل می‌شود و کل این شاخه — و msw همراهش — از درخت وابستگی حذف می‌شود.
 */
export const worker = setupWorker(...handlers);

export async function startMockWorker(): Promise<void> {
  await worker.start({
    // درخواست‌هایی که handler ندارند (فونت، آیکون، HMR) دست‌نخورده رد شوند
    onUnhandledRequest: 'bypass',
    quiet: false,
  });
}
