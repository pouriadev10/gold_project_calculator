/**
 * `swagger-ui-dist` تایپ ندارد. فقط همین فایل import می‌شود، نه ریشه‌ی بسته: index آن
 * باندل ۱٫۵ مگابایتی UI را داخل پروسه‌ی سرور `require` می‌کند، در حالی که اینجا فقط
 * مسیر پوشه لازم است تا فایل‌ها برای مرورگر فرستاده شوند.
 */
declare module 'swagger-ui-dist/absolute-path.js' {
  function getAbsoluteFSPath(): string;
  export = getAbsoluteFSPath;
}
