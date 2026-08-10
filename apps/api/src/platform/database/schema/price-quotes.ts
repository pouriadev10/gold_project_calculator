import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/** The market rate currently used by phase 1 pricing calculations. */
export const priceQuoteTypeEnum = pgEnum('price_quote_type', ['MAZNEH']);

/** `FEED` is reserved for BE-022; a manually entered quote is always `MANUAL`. */
export const priceQuoteSourceEnum = pgEnum('price_quote_source', ['MANUAL', 'FEED']);

export type PriceQuoteType = (typeof priceQuoteTypeEnum.enumValues)[number];
export type PriceQuoteSource = (typeof priceQuoteSourceEnum.enumValues)[number];

/**
 * Immutable observed market rates. A financial document will retain its own
 * locked rate, while this history remains the source of manually observed
 * market quotes and feed observations.
 */
export const priceQuotes = pgTable(
  'price_quotes',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    quoteType: priceQuoteTypeEnum().notNull(),
    amountRial: bigint({ mode: 'bigint' }).notNull(),
    source: priceQuoteSourceEnum().notNull(),
    observedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('price_quotes_amount_positive_check', sql`${table.amountRial} > 0`),
    unique('price_quotes_tenant_id_id_unique').on(table.tenantId, table.id),
    index('price_quotes_latest_lookup_idx').on(
      table.tenantId,
      table.quoteType,
      table.observedAt,
      table.createdAt,
    ),
  ],
);

export type PriceQuote = typeof priceQuotes.$inferSelect;
