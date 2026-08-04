import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/** Phase-1 party classifications; future types must be added deliberately. */
export const partyTypeEnum = pgEnum('party_type', ['CONSUMER', 'BUSINESS']);

/** Parties are retained for accounting history and become unavailable through this status. */
export const partyStatusEnum = pgEnum('party_status', ['ACTIVE', 'INACTIVE']);

export type PartyType = (typeof partyTypeEnum.enumValues)[number];
export type PartyStatus = (typeof partyStatusEnum.enumValues)[number];

/**
 * A tenant-scoped counterparty. `linkedTenantId` preserves the future option
 * for a party to represent another tenant on the platform without making that
 * relationship mandatory for local consumers and businesses.
 */
export const parties = pgTable(
  'parties',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    type: partyTypeEnum().notNull(),
    displayName: text().notNull(),
    normalizedName: text().notNull(),
    mobile: text(),
    normalizedMobile: text(),
    nationalId: text(),
    linkedTenantId: uuid().references(() => tenants.id, { onDelete: 'set null' }),
    status: partyStatusEnum().notNull().default('ACTIVE'),
    notes: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check('parties_display_name_nonblank_check', sql`length(btrim(${table.displayName})) > 0`),
    check(
      'parties_normalized_name_nonblank_check',
      sql`length(btrim(${table.normalizedName})) > 0`,
    ),
    check(
      'parties_mobile_normalization_pair_check',
      sql`(${table.mobile} IS NULL) = (${table.normalizedMobile} IS NULL)`,
    ),
    index('parties_tenant_normalized_name_idx').on(table.tenantId, table.normalizedName),
    index('parties_tenant_normalized_mobile_idx').on(table.tenantId, table.normalizedMobile),
  ],
);

export type Party = typeof parties.$inferSelect;
export type NewParty = typeof parties.$inferInsert;
