import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * جدول کارآزمایی جداسازی مستأجر — نه یک موجودیت دامنه.
 *
 * BE-009 می‌خواهد «test table برای اثبات جداسازی». این جدول همان است:
 * ساده‌ترین شکل ممکن از یک جدول داده‌ی مستأجر (`tenant_id` + یک ستون
 * معمولی) تا تست بتواند بدون درگیر شدن با منطق دامنه ثابت کند RLS
 * واقعاً در PostgreSQL اعمال می‌شود.
 *
 * جدول‌های واقعی دامنه از BE-023 (اشخاص) شروع می‌شوند و همگی همین الگو
 * را دنبال می‌کنند: ستون `tenant_id`، سپس `SELECT enable_tenant_rls(...)`
 * در مهاجرت.
 */
export const rlsProbes = pgTable('rls_probes', {
  id: uuid().primaryKey().defaultRandom(),
  /*
   * کلید خارجی با حذف آبشاری: مستأجر که برود، داده‌اش هم می‌رود.
   * برای جدول‌های مالی واقعی این تصمیم فرق خواهد کرد — دفتر کل
   * Append-Only است و هرگز حذف نمی‌شود (قاعده‌ی ۲-۷).
   */
  tenantId: uuid()
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  note: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type RlsProbe = typeof rlsProbes.$inferSelect;
