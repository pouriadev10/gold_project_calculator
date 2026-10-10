import { isValidTimeZone } from '@/lib/jalali';
import { useSessionStore } from '@/stores/session-store';

/**
 * منطقه‌ی زمانی مستأجر جاری — FE-071.
 *
 * مقدار از `session.tenant.timezone` (ستون `tenants.timezone` سرور) می‌آید.
 * نشست در localStorage ماندگار است و هنگام بارگذاری دوباره با schema
 * سنجیده نمی‌شود؛ پس نشستی که پیش از FE-071 ذخیره شده تا اولین تمدید
 * توکن این فیلد را ندارد. فقط در همین حالتِ گذرا (یا نام نامعتبر) منطقه‌ی
 * دستگاه جایگزین می‌شود — هیچ نام منطقه‌ای در کد ثابت نشده است.
 */
export function resolveTenantTimeZone(timeZone: string | null | undefined): string {
  if (isValidTimeZone(timeZone)) return timeZone;
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function useTenantTimeZone(): string {
  const timeZone = useSessionStore((state) => state.session?.tenant.timezone);
  return resolveTenantTimeZone(timeZone);
}
