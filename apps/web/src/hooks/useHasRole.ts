import { useSessionStore } from '@/stores/session-store';
import type { RoleCode } from '@/api/contracts';

/**
 * آیا نقش کاربر جاری در فهرست مجاز است؟ — FE-028.
 *
 * بدون نشست همیشه `false` است (رد پیش‌فرض، نه اجازه‌ی پیش‌فرض). فقط
 * برای UI (نمایش/پنهان یا فعال/غیرفعال) — تصمیم امنیتی واقعی همیشه
 * سمت سرور است.
 */
export function useHasRole(allowed: readonly RoleCode[]): boolean {
  const role = useSessionStore((state) => state.session?.role);
  return role !== undefined && allowed.includes(role);
}
