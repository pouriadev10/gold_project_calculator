import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const coinMintTypeEnum = pgEnum('coin_mint_type', [
  'CENTRAL_BANK',
  'PRIVATE_MINT',
  'OTHER',
]);

export type CoinMintType = (typeof coinMintTypeEnum.enumValues)[number];

/**
 * Stable identity of a coin dimension. Ledger entries refer to this identity
 * by count only; no ledger balance is ever expressed as gold weight.
 */
export const coinTypes = pgTable(
  'coin_types',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('coin_types_tenant_code_unique').on(table.tenantId, table.code),
    uniqueIndex('coin_types_tenant_id_id_unique').on(table.tenantId, table.id),
  ],
);

/**
 * Time-versioned coin specification. `grossWeightUg` is reference data for
 * intrinsic value/reporting only, and is micrograms so official half-milligram
 * coin weights remain exact. It is never a ledger storage unit.
 */
export const coinTypeVersions = pgTable(
  'coin_type_versions',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid().notNull(),
    coinTypeId: uuid().notNull(),
    title: text().notNull(),
    mintType: coinMintTypeEnum().notNull(),
    grossWeightUg: bigint({ mode: 'bigint' }).notNull(),
    karat: integer().notNull(),
    isCentralBankMinted: boolean().notNull(),
    validFrom: timestamp({ withTimezone: true }).notNull(),
    validTo: timestamp({ withTimezone: true }),
    version: integer().notNull(),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.coinTypeId],
      foreignColumns: [coinTypes.tenantId, coinTypes.id],
      name: 'coin_type_versions_tenant_coin_type_fk',
    }).onDelete('cascade'),
    check('coin_type_versions_weight_positive_check', sql`${table.grossWeightUg} > 0`),
    check(
      'coin_type_versions_karat_range_check',
      sql`${table.karat} BETWEEN 1 AND 1000`,
    ),
    check('coin_type_versions_version_positive_check', sql`${table.version} >= 1`),
    check(
      'coin_type_versions_valid_interval_check',
      sql`${table.validTo} IS NULL OR ${table.validTo} > ${table.validFrom}`,
    ),
    check(
      'coin_type_versions_central_bank_mint_check',
      sql`(
        (${table.isCentralBankMinted} AND ${table.mintType} = 'CENTRAL_BANK')
        OR
        (NOT ${table.isCentralBankMinted} AND ${table.mintType} <> 'CENTRAL_BANK')
      )`,
    ),
    uniqueIndex('coin_type_versions_tenant_type_version_unique').on(
      table.tenantId,
      table.coinTypeId,
      table.version,
    ),
    index('coin_type_versions_effective_lookup_idx').on(
      table.tenantId,
      table.coinTypeId,
      table.validFrom,
    ),
  ],
);

export type CoinType = typeof coinTypes.$inferSelect;
export type CoinTypeVersion = typeof coinTypeVersions.$inferSelect;
