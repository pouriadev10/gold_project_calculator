/**
 * خطاهای دامنه‌ی کاربر و عضویت.
 *
 * مثل `tenant.errors.ts` از `HttpException` ارث نمی‌برند: نگاشت به کد
 * وضعیت کار لایه‌ی HTTP است و در BE-017 به فیلتر سراسری منتقل می‌شود.
 */

/** ایمیل تکراری — یکتایی در سطح دیتابیس هم اجبار شده است. */
export class UserEmailConflictError extends Error {
  readonly email: string;

  constructor(email: string) {
    super(`کاربری با ایمیل «${email}» از قبل وجود دارد`);
    this.name = 'UserEmailConflictError';
    this.email = email;
  }
}

/**
 * کاربر از قبل عضو همین مستأجر است.
 *
 * قاعده‌ی BE-010: «membership تکراری ایجاد نشود». تغییر نقش یعنی
 * به‌روزرسانی همان عضویت، نه ساخت ردیف دوم.
 */
export class MembershipAlreadyExistsError extends Error {
  readonly tenantId: string;
  readonly userId: string;

  constructor(tenantId: string, userId: string) {
    super('این کاربر از قبل عضو این مستأجر است');
    this.name = 'MembershipAlreadyExistsError';
    this.tenantId = tenantId;
    this.userId = userId;
  }
}

/** ارجاع به مستأجر، کاربر یا نقشی که وجود ندارد. */
export class MembershipReferenceError extends Error {
  constructor() {
    super('مستأجر، کاربر یا نقش مورد نظر وجود ندارد');
    this.name = 'MembershipReferenceError';
  }
}
