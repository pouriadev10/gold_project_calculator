import type { ReactNode } from 'react';
import { useHasRole } from '@/hooks/useHasRole';
import type { RoleCode } from '@/api/contracts';

/**
 * بخشی از رابط کاربری را فقط برای نقش‌های مجاز نشان می‌دهد — FE-028.
 *
 * برای «پنهان‌کردن». برای «غیرفعال‌کردن» (اقدام دیده می‌شود ولی قابل زدن
 * نیست)، مستقیم از `useHasRole` در همان کامپوننت استفاده کن
 * (`disabled={!useHasRole([...])}`) — این wrapper فقط رندر شرطی می‌کند.
 */
export function RequireRole({
  roles,
  children,
}: {
  roles: readonly RoleCode[];
  children: ReactNode;
}) {
  const allowed = useHasRole(roles);
  return allowed ? <>{children}</> : null;
}
