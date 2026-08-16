import type { RoleCode } from '@/api/contracts';

/**
 * فهرست‌های سفید نقش — FE-028.
 *
 * فقط برای UI (نمایش/پنهان‌کردن). مرجع واقعی همیشه `RolesGuard` سمت
 * سرور است (`apps/api/src/platform/auth/roles.guard.ts`، BE-012)؛ اینجا
 * صرفاً همان تصمیم را زودتر، سمت کلاینت، برای تجربه‌ی کاربری تکرار
 * می‌کند. **فهرست سفید است، نه سلسله‌مراتب** — همان قاعده‌ی BE-012:
 * `OWNER` به‌صورت ضمنی چیزی نمی‌گیرد که برایش صریح نوشته نشده.
 */
export const PROFIT_REPORT_ROLES: readonly RoleCode[] = ['OWNER', 'MANAGER'];

/**
 * `@Roles('OWNER', 'MANAGER')` روی `POST /pricing/quotes/manual`
 * (`price-quotes.controller.ts`، BE-021). امروز همان دو نقش
 * `PROFIT_REPORT_ROLES` را دارد، ولی ثابت جدایی است — این دو مجوز
 * مفهوماً ربطی به هم ندارند و تصادفاً یک مقدار دارند؛ اگر یکی روزی
 * عوض شود نباید دیگری را با خودش عوض کند.
 */
export const MANUAL_QUOTE_ENTRY_ROLES: readonly RoleCode[] = ['OWNER', 'MANAGER'];
