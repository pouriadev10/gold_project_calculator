/**
 * خطاهای احراز هویت.
 *
 * `InvalidCredentialsError` عمداً **یک** خطا برای چند علت متفاوت است:
 * ایمیل ناموجود، رمز غلط، کاربر غیرفعال، و عضو نبودن در مستأجر همه یک
 * پیام می‌گیرند. تفکیکشان به مهاجم اجازه می‌داد با آزمون‌وخطا بفهمد کدام
 * ایمیل‌ها در سامانه ثبت‌اند.
 */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('ایمیل یا رمز عبور نادرست است');
    this.name = 'InvalidCredentialsError';
  }
}

/**
 * مستأجر معلق است.
 *
 * این یکی جدا از `InvalidCredentialsError` است و علتش را صریح می‌گوید،
 * چون فقط **بعد از** تأیید موفق رمز و عضویت پرتاب می‌شود — یعنی مخاطبش
 * کسی است که ثابت کرده صاحب حساب است، نه یک مهاجم در حال حدس زدن.
 * نگه داشتنش مبهم فقط کاربر واقعی را سردرگم می‌کرد.
 */
export class TenantSuspendedError extends Error {
  constructor() {
    super('این مستأجر معلق است و امکان ورود ندارد');
    this.name = 'TenantSuspendedError';
  }
}

/** توکن تمدید نامعتبر، منقضی یا باطل‌شده است. */
export class InvalidRefreshTokenError extends Error {
  constructor() {
    super('نشست معتبر نیست یا منقضی شده است');
    this.name = 'InvalidRefreshTokenError';
  }
}
