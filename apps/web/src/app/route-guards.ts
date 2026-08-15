import { redirect } from '@tanstack/react-router';
import { useSessionStore } from '@/stores/session-store';
import type { RoleCode } from '@/api/contracts';

/**
 * محافظ‌های مسیر — FE-028.
 *
 * از `router.tsx` جدا نگه داشته می‌شوند تا بدون رندر کل روتر و برنامه
 * مستقیماً تست شوند. هر دو فقط **راحتی رابط کاربری**اند؛ مرز امنیتی
 * واقعی همیشه سمت سرور است (`JwtAuthGuard`/`RolesGuard`، BE-011/BE-012).
 */

/**
 * روی ریشه‌ی همه‌ی مسیرهای پوسته‌دار (`appShellRoute`) سوار می‌شود.
 * بدون نشست، بدون `reason` به ورود می‌رود — کاربر هرگز وارد نشده، نه
 * اینکه نشستش منقضی شده باشد (آن حالت را FE-027 با reason=expired
 * جدا مدیریت می‌کند).
 */
export function requireAuth(): void {
  if (!useSessionStore.getState().session) {
    throw redirect({ to: '/login' });
  }
}

/**
 * فهرست سفید نقش برای یک مسیر مشخص — نه سلسله‌مراتب (قاعده‌ی BE-012).
 * بدون نشست یا نقش خارج از فهرست، به `/forbidden` می‌رود.
 */
export function requireRole(allowed: readonly RoleCode[]): () => void {
  return () => {
    const role = useSessionStore.getState().session?.role;
    if (role === undefined || !allowed.includes(role)) {
      throw redirect({ to: '/forbidden' });
    }
  };
}
