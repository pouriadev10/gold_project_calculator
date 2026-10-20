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

/**
 * الگوی `LIKE`/`ILIKE` ِ «شامل این متن».
 *
 * `%` و `_` در ورودی کاربر معنای wildcard دارند و باید خنثی شوند، وگرنه جست‌وجوی
 * «٪» همه‌چیز را برمی‌گرداند و «علی_» هر نویسه‌ای را جای «_» می‌پذیرد. کاراکتر فرار
 * پیش‌فرض LIKE در PostgreSQL همان backslash است، پس `ESCAPE` صریح لازم نیست. پیش‌تر
 * فقط جست‌وجوی کالا این را داشت؛ جست‌وجوی شخص در سه مسیر نه (M-04).
 */
export function likeContainsPattern(value: string): string {
  return `%${value.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
}
