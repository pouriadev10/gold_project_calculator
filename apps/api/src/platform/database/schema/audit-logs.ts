import { sql } from 'drizzle-orm';
import { index, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/** داده‌ی JSON امنی که می‌تواند در ردّ ممیزی ذخیره شود. */
export type AuditData =
  | boolean
  | null
  | string
  | readonly AuditData[]
  | { readonly [key: string]: AuditData };

/**
 * ردّ ممیزی تغییرناپذیر عملیات حساس — BE-014.
 *
 * `actor_user_id` بعد از حذف کاربر null می‌شود تا تاریخچه باقی بماند؛ حذف
 * مستأجر در محیط توسعه همه‌ی داده‌های همان مستأجر، از جمله audit، را پاک می‌کند.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    beforeData: jsonb().$type<AuditData>(),
    afterData: jsonb().$type<AuditData>(),
    metadata: jsonb().$type<AuditData>().notNull().default(sql`'{}'::jsonb`),
    ipAddress: inet(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_tenant_created_at_idx').on(table.tenantId, table.createdAt),
    index('audit_logs_entity_idx').on(table.tenantId, table.entityType, table.entityId),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
