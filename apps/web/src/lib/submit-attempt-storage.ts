/**
 * پیشوند کلید sessionStorage ِ تلاش‌های ثبت مالی سنجاق‌شده — FE-100 (`useFinancialSubmit`).
 * ماژول جدا و بی‌وابستگی است تا پاک‌سازی نشست/مستأجر (FE-101/102) و setup تست بتوانند همه را با
 * همین پیشوند پیدا کنند، بی‌آنکه کل هوک و client ِ API را بارگذاری کنند.
 */
export const SUBMIT_ATTEMPT_STORAGE_PREFIX = 'gold-ui-submit-attempt:';

/** تلاش سنجاق‌شده‌ی Buyback B2C (`useB2cBuybackSubmit`، پیش از FE-100) — همان نوع داده، کلید جدا. */
export const B2C_BUYBACK_ATTEMPT_STORAGE_PREFIX = 'gold-ui-b2c-buyback-attempt:';

/** همه‌ی پیشوندهای تلاش ثبت — پاک‌سازی داده‌ی مستأجر (FE-101) همه را می‌گردد. */
export const SUBMIT_ATTEMPT_STORAGE_PREFIXES = [
  SUBMIT_ATTEMPT_STORAGE_PREFIX,
  B2C_BUYBACK_ATTEMPT_STORAGE_PREFIX,
] as const;
