import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '../database/tenant-transaction';

/**
 * منطقه‌ی زمانی مستأجرِ همین تراکنش — مرز سال شماره‌گذاری (D-02) و مرز «امروز» ِ داشبورد (M-19).
 *
 * نقش `gold_app` به جدول سراسری `tenants` دسترسی ندارد؛ تابع دیتابیسی
 * `current_tenant_timezone()` (مهاجرت 0037) فقط timezone ِ مستأجری را می‌دهد که
 * RLS برایش تنظیم شده.
 */
export async function currentTenantTimeZone(transaction: TenantTransaction): Promise<string> {
  const result = await transaction.execute<{ timezone: string | null }>(
    sql`SELECT current_tenant_timezone() AS timezone`,
  );
  const timeZone = result.rows[0]?.timezone;
  if (typeof timeZone !== 'string' || timeZone === '') {
    throw new Error('Tenant time zone is not available inside the tenant transaction');
  }
  return timeZone;
}

export interface TenantDayBounds {
  readonly start: Date;
  readonly end: Date;
}

/**
 * روز تقویمی ِ مستأجر که `asOf` در آن است: از نیمه‌شب تا نیمه‌شب بعدی **به وقت مستأجر**،
 * به‌صورت دو لحظه‌ی مطلق. با تقویم PostgreSQL حساب می‌شود، پس تغییر ساعت تابستانی هم درست است.
 * پیش از M-19 داشبورد روز UTC را «امروز» می‌گرفت: برای تهران از ۰۳:۳۰ تا ۰۳:۳۰ (#1).
 */
export async function tenantDayBounds(
  transaction: TenantTransaction,
  asOf: Date,
): Promise<TenantDayBounds> {
  const result = await transaction.execute<{ start: string; end: string }>(sql`
    SELECT
      to_char((date_trunc('day', ${asOf.toISOString()}::timestamptz AT TIME ZONE tenant.tz) AT TIME ZONE tenant.tz)
        AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS start,
      to_char(((date_trunc('day', ${asOf.toISOString()}::timestamptz AT TIME ZONE tenant.tz) + interval '1 day')
        AT TIME ZONE tenant.tz) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "end"
    FROM (SELECT current_tenant_timezone() AS tz) AS tenant
  `);
  const row = result.rows[0];
  if (row === undefined || typeof row.start !== 'string' || typeof row.end !== 'string') {
    throw new Error('Tenant day bounds are not available inside the tenant transaction');
  }
  return { start: new Date(row.start), end: new Date(row.end) };
}
