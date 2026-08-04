import { sql } from 'drizzle-orm';
import type { Database } from './connect';

/**
 * نقشی که تراکنش‌های داده‌ی مستأجر با آن اجرا می‌شوند.
 *
 * باید دقیقاً همان نامی باشد که مهاجرت `0003_tenant_rls.sql` می‌سازد.
 * نقشی غیرسوپرکاربر و بدون BYPASSRLS — وگرنه PostgreSQL سیاست‌ها را
 * کاملاً نادیده می‌گیرد و جداسازی فقط یک توهم است.
 */
export const APP_DATABASE_ROLE = 'gold_app';

/** نام تنظیمی که سیاست‌های RLS از آن مستأجر جاری را می‌خوانند. */
export const TENANT_SETTING = 'app.current_tenant_id';

/** تراکنشی که داخل آن نقش و مستأجر تنظیم شده‌اند. */
export type TenantTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Establishes the limited DB role and tenant scope for an already-open transaction. */
export async function configureTenantTransaction(
  transaction: TenantTransaction,
  tenantId: string,
): Promise<void> {
  await transaction.execute(sql.raw(`SET LOCAL ROLE ${APP_DATABASE_ROLE}`));
  await transaction.execute(sql`SELECT set_config(${TENANT_SETTING}, ${tenantId}, true)`);
}

/**
 * تنها مسیر مجاز دسترسی به داده‌ی مستأجر — BE-009.
 *
 * دو کار در ابتدای تراکنش انجام می‌شود:
 *
 * ۱. `SET LOCAL ROLE` به نقش محدود برنامه. بدون این، اتصال با کاربر
 *    سوپرکاربر توسعه اجرا می‌شود و PostgreSQL کل RLS را دور می‌زند.
 * ۲. `set_config` برای مستأجر جاری، که سیاست‌ها با آن تطبیق می‌دهند.
 *
 * هر دو با پارامتر `is_local = true` یعنی دامنه‌شان همین تراکنش است و در
 * پایانش — چه commit چه rollback — خودبه‌خود برمی‌گردند. پس نشت مستأجر
 * به تراکنش بعدیِ همان اتصال pool ممکن نیست.
 *
 * چرا `set_config()` و نه `SET LOCAL app.current_tenant_id = $1`؟ چون
 * دستور `SET` اصلاً پارامتر نمی‌پذیرد و تنها راهش الحاق رشته بود — یعنی
 * ساختن یک مسیر تزریق SQL دقیقاً در حساس‌ترین نقطه‌ی سیستم.
 */
export async function withTenantTransaction<T>(
  db: Database,
  tenantId: string,
  work: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    /*
     * `SET LOCAL ROLE` پارامتر نمی‌پذیرد، ولی اینجا مقدار از ورودی کاربر
     * نمی‌آید — یک ثابت کد است، نه داده.
     */
    await configureTenantTransaction(tx, tenantId);

    return work(tx);
  });
}
