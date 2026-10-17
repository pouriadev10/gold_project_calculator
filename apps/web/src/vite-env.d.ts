/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * ریشه‌ی آدرس API. نبودنش یعنی `/api` (نسبی) — همان چیزی که MSW در
   * توسعه و یک reverse proxy در production معمولاً سرو می‌کنند. فقط وقتی
   * لازم است ست شود که بک‌اند روی origin دیگری باشد.
   */
  readonly VITE_API_BASE_URL?: string;
  /**
   * FE-106a — فقط توسعه: `real` یعنی بدون MSW و `/api` با proxy ِ Vite به `VITE_API_PROXY_TARGET`.
   * هر مقدار دیگر یا نبودنش = MSW ِ قراردادمحور. production همیشه API واقعی است.
   */
  readonly VITE_API_MODE?: string;
  /** FE-106a — مقصد proxy ِ `/api` در `VITE_API_MODE=real`؛ پیش‌فرض `http://localhost:3000`. */
  readonly VITE_API_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
