/** کدهای خطای PostgreSQL که کد دامنه به آن‌ها واکنش نشان می‌دهد. */
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

/**
 * سقف پیمایش زنجیره‌ی `cause` — نگهبان در برابر زنجیره‌ی حلقوی.
 * در عمل عمق واقعی یک است (wrapper درزل روی خطای pg).
 */
const MAX_CAUSE_DEPTH = 5;

/**
 * کد خطای PostgreSQL را از هر جای زنجیره‌ی `cause` بیرون می‌کشد.
 *
 * پیمایش زنجیره لازم است چون drizzle خطای درایور `pg` را در
 * `DrizzleQueryError` می‌پیچد و `code` روی شیء بیرونی وجود ندارد. نسخه‌ی
 * اول این منطق در BE-007 فقط سطح اول را می‌دید و نتیجه‌اش ۵۰۰ به‌جای ۴۰۹
 * بود؛ تستِ slug تکراری گرفتش. حالا مشترک است تا همان اشتباه در سرویس
 * بعدی تکرار نشود.
 */
export function getPostgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }

    const code = (current as { code?: unknown }).code;

    if (typeof code === 'string') {
      return code;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}

/** نقض محدودیت یکتایی — مثل slug تکراری یا عضویت تکراری. */
export function isUniqueViolation(error: unknown): boolean {
  return getPostgresErrorCode(error) === UNIQUE_VIOLATION;
}

/** نقض کلید خارجی — مثل ارجاع به مستأجر یا کاربری که وجود ندارد. */
export function isForeignKeyViolation(error: unknown): boolean {
  return getPostgresErrorCode(error) === FOREIGN_KEY_VIOLATION;
}

/** نقض محدودیت `CHECK` — مثل عیار خارج از بازه یا کسورات بیشتر از وزن. */
export function isCheckViolation(error: unknown): boolean {
  return getPostgresErrorCode(error) === CHECK_VIOLATION;
}

/**
 * نام محدودیتی که نقض شده.
 *
 * مثل `getPostgresErrorCode` زنجیره‌ی `cause` را می‌پیماید: پیام بیرونیِ
 * drizzle فقط «Failed query» است و نام محدودیت روی خطای درایور `pg`
 * داخل `cause` می‌نشیند. بدون این، تشخیص اینکه **کدام** محدودیت شکسته
 * فقط با تطبیق رشته روی متن SQL ممکن بود.
 */
export function getPostgresConstraintName(error: unknown): string | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }

    const constraint = (current as { constraint?: unknown }).constraint;

    if (typeof constraint === 'string') {
      return constraint;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}
