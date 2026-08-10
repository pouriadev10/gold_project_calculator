/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * ریشه‌ی آدرس API. نبودنش یعنی `/api` (نسبی) — همان چیزی که MSW در
   * توسعه و یک reverse proxy در production معمولاً سرو می‌کنند. فقط وقتی
   * لازم است ست شود که بک‌اند روی origin دیگری باشد.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
