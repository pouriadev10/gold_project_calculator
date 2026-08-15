import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { coinTypes } from './coin-types';
import { parties } from './parties';
import { priceQuotes } from './price-quotes';
import { salesInvoices } from './sales-invoices';
import { tenants } from './tenants';
import { users } from './users';

/**
 * Purchase snapshots are JSON-safe by design. Money, weights, and counts in a
 * snapshot must be strings; the typed bigint/integer columns remain the
 * accounting source of truth.
 */
export type SecondHandPurchaseSnapshotValue =
  | boolean
  | null
  | string
  | readonly SecondHandPurchaseSnapshotValue[]
  | { readonly [key: string]: SecondHandPurchaseSnapshotValue };

/** A purchase can receive either physical gold or a countable coin position. */
export const secondHandPurchaseItemTypeEnum = pgEnum('second_hand_purchase_item_type', [
  'GOLD',
  'COIN',
]);

export type SecondHandPurchaseItemType = (typeof secondHandPurchaseItemTypeEnum.enumValues)[number];

/**
 * Second-hand gold is always refined into melted-gold inventory. Coins retain
 * their independent countable inventory dimension and can never use a weight
 * field on this document.
 */
export const secondHandPurchaseDestinationInventoryTypeEnum = pgEnum(
  'second_hand_purchase_destination_inventory_type',
  ['MELTED_GOLD', 'COIN'],
);

export type SecondHandPurchaseDestinationInventoryType =
  (typeof secondHandPurchaseDestinationInventoryTypeEnum.enumValues)[number];

/**
 * Immutable source document for a purchase from a consumer. A B2C buyback is
 * the same kind of new purchase with an optional `sourceInvoiceId`; it never
 * rewrites or reverses the original sale invoice.
 *
 * `settingsSnapshot` preserves the effective purchase-karat setting together
 * with every pricing setting needed to reproduce the amount. `feeRial` is a
 * deduction applied to this purchase only: an original sale's wage is never
 * copied here or used to determine today's payment.
 */
export const secondHandPurchases = pgTable(
  'second_hand_purchases',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    partyId: uuid().notNull(),
    sourceInvoiceId: uuid(),
    lockedQuoteId: uuid().notNull(),
    lockedQuoteAmountRial: bigint({ mode: 'bigint' }).notNull(),
    lockedQuoteObservedAt: timestamp({ withTimezone: true }).notNull(),
    settingsSnapshot: jsonb().$type<SecondHandPurchaseSnapshotValue>().notNull(),
    sellerIdentitySnapshot: jsonb().$type<SecondHandPurchaseSnapshotValue>().notNull(),
    feeRial: bigint({ mode: 'bigint' }).notNull(),
    finalAmountRial: bigint({ mode: 'bigint' }).notNull(),
    effectiveAt: timestamp({ withTimezone: true }).notNull(),
    finalizedAt: timestamp({ withTimezone: true }).notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.partyId],
      foreignColumns: [parties.tenantId, parties.id],
      name: 'second_hand_purchases_tenant_party_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.sourceInvoiceId],
      foreignColumns: [salesInvoices.tenantId, salesInvoices.id],
      name: 'second_hand_purchases_tenant_source_invoice_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantId, table.lockedQuoteId],
      foreignColumns: [priceQuotes.tenantId, priceQuotes.id],
      name: 'second_hand_purchases_tenant_quote_fk',
    }).onDelete('restrict'),

    check(
      'second_hand_purchases_locked_quote_amount_positive_check',
      sql`${table.lockedQuoteAmountRial} > 0`,
    ),
    check('second_hand_purchases_fee_nonnegative_check', sql`${table.feeRial} >= 0`),
    check('second_hand_purchases_final_amount_positive_check', sql`${table.finalAmountRial} > 0`),

    unique('second_hand_purchases_tenant_id_id_unique').on(table.tenantId, table.id),
    index('second_hand_purchases_tenant_party_effective_at_idx').on(
      table.tenantId,
      table.partyId,
      table.effectiveAt,
    ),
    index('second_hand_purchases_tenant_source_invoice_idx').on(
      table.tenantId,
      table.sourceInvoiceId,
    ),
  ],
);

/**
 * Immutable acquired-item lines. Gold has an explicit gross/deductions/karat
 * snapshot and always enters melted-gold inventory. A coin line carries only
 * its type and integer count, so a coin can never be normalized to gold weight
 * in storage.
 */
export const secondHandPurchaseItems = pgTable(
  'second_hand_purchase_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    secondHandPurchaseId: uuid().notNull(),
    itemType: secondHandPurchaseItemTypeEnum().notNull(),
    destinationInventoryType: secondHandPurchaseDestinationInventoryTypeEnum()
      .notNull()
      .default('MELTED_GOLD'),
    grossWeightMg: bigint({ mode: 'bigint' }),
    stoneWeightMg: bigint({ mode: 'bigint' }),
    otherDeductionWeightMg: bigint({ mode: 'bigint' }),
    purchaseKarat: integer(),
    pureWeightMg: bigint({ mode: 'bigint' }),
    coinTypeId: uuid(),
    coinCount: integer(),
    itemSnapshot: jsonb().$type<SecondHandPurchaseSnapshotValue>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.secondHandPurchaseId],
      foreignColumns: [secondHandPurchases.tenantId, secondHandPurchases.id],
      name: 'second_hand_purchase_items_tenant_purchase_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.coinTypeId],
      foreignColumns: [coinTypes.tenantId, coinTypes.id],
      name: 'second_hand_purchase_items_tenant_coin_type_fk',
    }).onDelete('restrict'),

    check(
      'second_hand_purchase_items_destination_matches_type_check',
      sql`(${table.itemType} = 'GOLD') = (${table.destinationInventoryType} = 'MELTED_GOLD')`,
    ),
    check(
      'second_hand_purchase_items_gold_fields_check',
      sql`
        ${table.itemType} <> 'GOLD' OR (
          ${table.grossWeightMg} > 0 AND
          ${table.stoneWeightMg} >= 0 AND
          ${table.otherDeductionWeightMg} >= 0 AND
          ${table.grossWeightMg} >= ${table.stoneWeightMg} + ${table.otherDeductionWeightMg} AND
          ${table.purchaseKarat} BETWEEN 1 AND 1000 AND
          ${table.pureWeightMg} > 0 AND
          ${table.coinTypeId} IS NULL AND
          ${table.coinCount} IS NULL
        )
      `,
    ),
    check(
      'second_hand_purchase_items_coin_fields_check',
      sql`
        ${table.itemType} <> 'COIN' OR (
          ${table.grossWeightMg} IS NULL AND
          ${table.stoneWeightMg} IS NULL AND
          ${table.otherDeductionWeightMg} IS NULL AND
          ${table.purchaseKarat} IS NULL AND
          ${table.pureWeightMg} IS NULL AND
          ${table.coinTypeId} IS NOT NULL AND
          ${table.coinCount} > 0
        )
      `,
    ),

    unique('second_hand_purchase_items_tenant_id_id_unique').on(table.tenantId, table.id),
    index('second_hand_purchase_items_tenant_purchase_idx').on(
      table.tenantId,
      table.secondHandPurchaseId,
    ),
  ],
);

export type SecondHandPurchase = typeof secondHandPurchases.$inferSelect;
export type SecondHandPurchaseItem = typeof secondHandPurchaseItems.$inferSelect;
