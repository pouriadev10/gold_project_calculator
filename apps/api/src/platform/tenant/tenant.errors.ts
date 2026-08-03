/**
 * خطاهای دامنه‌ی مستأجر.
 *
 * عمداً از `HttpException` نست ارث نمی‌برند: Service نباید بداند
 * مصرف‌کننده‌اش HTTP است یا یک job پس‌زمینه. نگاشت به کد وضعیت کار
 * controller است، و در BE-017 به فیلتر سراسری خطا منتقل می‌شود.
 */

/** slug تکراری — یکتایی در سطح دیتابیس هم اجبار شده است. */
export class TenantSlugConflictError extends Error {
  readonly slug: string;

  constructor(slug: string) {
    super(`مستأجری با شناسه‌ی «${slug}» از قبل وجود دارد`);
    this.name = 'TenantSlugConflictError';
    this.slug = slug;
  }
}

/**
 * تلاش برای عملیات نوشتنی روی مستأجر غیرفعال.
 *
 * قاعده‌ی BE-007: «tenant غیرفعال اجازه‌ی عملیات نوشتنی نداشته باشد».
 * نقطه‌ی اعمالش از BE-008 به بعد لایه‌ی request context است؛ اینجا فقط
 * خودِ قاعده به‌صورت قابل‌تست تعریف شده تا هر مصرف‌کننده‌ای همان یک
 * تعریف را به کار ببرد، نه نسخه‌ی دست‌ساز خودش.
 */
export class TenantNotWritableError extends Error {
  readonly tenantId: string;

  constructor(tenantId: string) {
    super('مستأجر غیرفعال است و اجازه‌ی عملیات نوشتنی ندارد');
    this.name = 'TenantNotWritableError';
    this.tenantId = tenantId;
  }
}
