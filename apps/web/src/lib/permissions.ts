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
