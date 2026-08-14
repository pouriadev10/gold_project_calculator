import { z } from 'zod';

/**
 * ورود و نشست — آینه‌ی دستی `loginSchema`/`SessionResponse` در
 * `apps/api/src/platform/auth/` (BE-011).
 *
 * BE-011 پیش از استقرار قاعده‌ی «یک قرارداد Zod مشترک» ساخته شد، پس
 * schema بک‌اند هنوز مستقیم از این پکیج import نمی‌شود — این‌جا همان
 * قواعد (طول ایمیل، حداقل رمز هنگام ورود، الزامی‌بودن tenantSlug) دستی
 * آینه می‌شود تا فرم فرانت با endpoint واقعی هم‌خوان بماند. اگر قواعد
 * آن‌طرف عوض شود، این‌جا هم باید دستی به‌روز شود.
 */

const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 256;

export const loginEmailSchema = z
  .string()
  .trim()
  .max(MAX_EMAIL_LENGTH)
  .email('ایمیل معتبر نیست')
  .transform((value) => value.toLowerCase());

/**
 * حداقل طول رمز اینجا عمداً ۱ است، نه سیاست ثبت‌نام/بازنشانی رمز. رد کردن
 * رمز کوتاه پیش از تلاش برای ورود یعنی افشای اطلاعات اضافه درباره‌ی
 * سیاست رمز به کسی که هنوز اثبات نکرده صاحب حساب است — پاسخ درست همیشه
 * فقط «ایمیل یا رمز عبور نادرست است» است.
 */
export const loginSchema = z.object({
  email: loginEmailSchema,
  password: z.string().min(1, 'رمز عبور الزامی است').max(MAX_PASSWORD_LENGTH),
  /** کاربر می‌تواند عضو چند مستأجر باشد؛ slug گرفته می‌شود چون چیزی است که کاربر می‌شناسد. */
  tenantSlug: z.string().trim().min(1, 'شناسه‌ی مستأجر الزامی است'),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** پاسخ نشست — هرگز `passwordHash` یا فیلد حساس دیگری ندارد (قاعده‌ی BE-011). */
export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
});

export const sessionTenantSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
});

export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
  user: sessionUserSchema,
  tenant: sessionTenantSchema,
  /** نقش خام رشته‌ای — نگاشت به enum نقش‌ها کار FE-028 است. */
  role: z.string(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/**
 * تمدید نشست — `POST /auth/refresh` (FE-027).
 *
 * BE-011 با **چرخش توکن** تمدید می‌کند: توکن تمدید قبلی همیشه باطل
 * می‌شود و پاسخ یک `SessionResponse` کامل با توکن‌های تازه برمی‌گرداند.
 * یعنی سمت کلاینت باید *هر بار* هر دو توکن تازه را جایگزین قبلی کند،
 * نه فقط accessToken را — وگرنه تمدید بعدی با توکن باطل‌شده رد می‌شود.
 */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'توکن تمدید الزامی است'),
});
export type RefreshInput = z.infer<typeof refreshSchema>;
