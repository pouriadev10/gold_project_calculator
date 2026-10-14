/**
 * پیشوند کلید sessionStorage ِ تلاش‌های ثبت مالی سنجاق‌شده — FE-100 (`useFinancialSubmit`).
 * ماژول جدا و بی‌وابستگی است تا پاک‌سازی نشست/مستأجر (FE-101/102) و setup تست بتوانند همه را با
 * همین پیشوند پیدا کنند، بی‌آنکه کل هوک و client ِ API را بارگذاری کنند.
 */
export const SUBMIT_ATTEMPT_STORAGE_PREFIX = 'gold-ui-submit-attempt:';
