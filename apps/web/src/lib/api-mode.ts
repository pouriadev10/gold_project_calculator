/**
 * منبع داده‌ی توسعه — FE-106a.
 *
 * - **production:** همیشه API واقعی؛ MSW هرگز بارگذاری نمی‌شود و هیچ fallback ِ ساختگی وجود ندارد.
 *   (`import.meta.env.DEV` در بیلد false است و `scripts/check-no-mocks.mjs` خروجی را هم می‌سنجد.)
 * - **توسعه، پیش‌فرض:** MSW ِ قراردادمحور (FE-093) — بدون Docker و PostgreSQL، با سناریوهای خطا.
 * - **توسعه با `VITE_API_MODE=real`:** MSW بارگذاری نمی‌شود؛ `/api` با proxy ِ Vite به سرور NestJS
 *   (`VITE_API_PROXY_TARGET`، پیش‌فرض `http://localhost:3000`) می‌رود و پیشوند `/api` حذف می‌شود،
 *   چون API پیشوند سراسری ندارد.
 *
 * هر مقدار دیگری جز `real` (یا نبودنش) یعنی mock — تا غلط تایپی بی‌صدا توسعه را به سرور ناموجود نبرد.
 */
export type ApiMode = 'mock' | 'real';

export const DEFAULT_API_PROXY_TARGET = 'http://localhost:3000';

/** تفسیر `VITE_API_MODE`؛ فقط `real` (بدون حساسیت به حروف و فاصله) API واقعی است. */
export function resolveApiMode(value: string | undefined): ApiMode {
  return value?.trim().toLowerCase() === 'real' ? 'real' : 'mock';
}

/** آیا worker ِ MSW باید بالا بیاید؟ production هرگز، صرف‌نظر از هر متغیری. */
export function shouldStartMockWorker(env: { readonly DEV: boolean; readonly VITE_API_MODE?: string | undefined }): boolean {
  return env.DEV && resolveApiMode(env.VITE_API_MODE) === 'mock';
}
