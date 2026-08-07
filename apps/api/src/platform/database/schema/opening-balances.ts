import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/**
 * Source document for an initial inventory position.
 *
 * The individual quantities stay in the append-only inventory movements and
 * matching ledger entries. This immutable header gives both ledgers one
 * traceable source document without duplicating financial quantities.
 */
export const openingBalances = pgTable(
  'opening_balances',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    effectiveAt: timestamp({ withTimezone: true }).notNull(),
    description: text().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'opening_balances_description_nonblank_check',
      sql`length(btrim(${table.description})) > 0`,
    ),
    index('opening_balances_tenant_effective_at_idx').on(table.tenantId, table.effectiveAt),
  ],
);

export type OpeningBalance = typeof openingBalances.$inferSelect;
