import { normalizePersian, searchKey } from '@gold/core-calc';

/**
 * مرز API برای متنی که باید **نمایش داده و ذخیره** شود.
 *
 * فقط فیلدهای انسانیِ مشخص (نام شخص، نام مستأجر، یادداشت و مانند آن‌ها)
 * باید این تابع را صدا بزنند. استفاده‌ی سراسری از آن رمز، ایمیل، slug یا
 * شناسه‌ها را بی‌صدا تغییر می‌دهد و عمداً ممنوع است.
 */
export function normalizeTextForStorage(value: string): string {
  return normalizePersian(value);
}

/** کلید جست‌وجوی متنی با همان قرارداد ذخیره‌سازی. */
export function normalizeTextForSearch(value: string): string {
  return searchKey(value);
}
