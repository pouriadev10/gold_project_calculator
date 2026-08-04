import { z } from 'zod';
import { PHASE_ONE_ROLES } from '../database/schema';

const MAX_EMAIL_LENGTH = 254;
const MAX_DISPLAY_NAME_LENGTH = 200;

/**
 * ایمیل همیشه با حروف کوچک ذخیره می‌شود.
 *
 * یکتایی روی مقدار **ذخیره‌شده** اعمال می‌شود، پس بدون این نرمال‌سازی
 * `Ali@x.com` و `ali@x.com` دو حساب جدا می‌ساختند و کاربر نمی‌فهمید چرا
 * ورودش کار نمی‌کند. تبدیل اینجا انجام می‌شود تا هیچ مسیری به سرویس
 * نرسد که از آن عبور نکرده باشد.
 */
export const emailSchema = z
  .string()
  .trim()
  .max(MAX_EMAIL_LENGTH)
  .email('ایمیل معتبر نیست')
  .transform((value) => value.toLowerCase());

export const createUserSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(1, 'نام نمایشی الزامی است').max(MAX_DISPLAY_NAME_LENGTH),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/** نقش‌های مجاز فاز ۱ — همان مجموعه‌ای که در جدول `roles` seed شده است. */
export const roleCodeSchema = z.enum(PHASE_ONE_ROLES);

export const addMembershipSchema = z.object({
  userId: z.string().uuid(),
  roleCode: roleCodeSchema,
});

export type AddMembershipInput = z.infer<typeof addMembershipSchema>;

/** تغییر نقش همان عضویت موجود است؛ رکورد عضویت دوم ساخته نمی‌شود. */
export const changeMembershipRoleSchema = z.object({
  roleCode: roleCodeSchema,
});

export type ChangeMembershipRoleInput = z.infer<typeof changeMembershipRoleSchema>;
