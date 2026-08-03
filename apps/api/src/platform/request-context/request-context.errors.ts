/** نام هدر موقتی که مستأجر را مشخص می‌کند. با احراز هویت BE-011 جایگزین می‌شود. */
export const TENANT_HEADER = 'x-tenant-id';

/**
 * دسترسی به context خارج از یک درخواست.
 *
 * این خطای برنامه‌نویسی است، نه خطای کاربر — یعنی کدی که به مستأجر جاری
 * نیاز دارد از مسیری صدا زده شده که هرگز از میان‌افزار عبور نکرده.
 */
export class MissingRequestContextError extends Error {
  constructor() {
    super('خارج از context درخواست، مستأجر جاری وجود ندارد');
    this.name = 'MissingRequestContextError';
  }
}
