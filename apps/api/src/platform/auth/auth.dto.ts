import { z } from 'zod';
import { emailSchema } from '../users/user.dto';

/**
 * حداقل طول رمز عبور. مرز امنیتی است، نه عدد صنفی.
 * سقف هم لازم است: Argon2 روی ورودی چندمگابایتی زمان و حافظه می‌سوزاند،
 * یعنی یک مسیر ساده‌ی DoS از همان صفحه‌ی ورود.
 */
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `رمز عبور حداقل ${MIN_PASSWORD_LENGTH} کاراکتر است`)
  .max(MAX_PASSWORD_LENGTH);

export const loginSchema = z.object({
  email: emailSchema,
  /*
   * رمز عبور عمداً `trim` نمی‌شود — فاصله بخشی از رمز است و حذفش یعنی
   * رمزی که کاربر ثبت کرده با رمزی که می‌فرستد فرق کند.
   */
  password: z.string().min(1, 'رمز عبور الزامی است').max(MAX_PASSWORD_LENGTH),
  /**
   * کاربر می‌تواند عضو چند مستأجر باشد، پس ورود باید بگوید کدام.
   * slug گرفته می‌شود نه UUID، چون چیزی است که کاربر می‌شناسد.
   */
  tenantSlug: z.string().trim().min(1, 'شناسه‌ی مستأجر الزامی است'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'توکن تمدید الزامی است'),
});

export type RefreshInput = z.infer<typeof refreshSchema>;
