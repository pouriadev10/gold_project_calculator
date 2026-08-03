/**
 * خطای اتصال دیتابیس.
 *
 * پیام یک آدم که سرور را بالا می‌آورد را مستقیم مخاطب قرار می‌دهد:
 * «دیتابیس در دسترس نیست»، نه پشته‌ی خطای درایور pg. آنچه از خطای اصلی
 * نگه داشته می‌شود فقط `cause.message` است — که در بدترین حالت شامل
 * host/port/نام کاربری است، هرگز رمز عبور (رمز جزو payload خطای
 * احراز هویت pg نیست، فقط در پیام‌های «password authentication failed»
 * می‌آید که خودِ رمز را افشا نمی‌کند).
 */
export class DatabaseConnectionError extends Error {
  constructor(cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`اتصال به دیتابیس برقرار نشد: ${reason}`);
    this.name = 'DatabaseConnectionError';
    this.cause = cause;
  }
}
