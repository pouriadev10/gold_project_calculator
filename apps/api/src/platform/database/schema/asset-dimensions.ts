import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { coinTypes } from './coin-types';
import { tenants } from './tenants';

/**
 * ابعاد مستقل دفتر کل. هیچ نرخ یا وزنی در این identity ذخیره نمی‌شود؛
 * فقط تعیین می‌کند quantity هر entry با چه واحدی معنا دارد.
 */
export const assetDimensionKindEnum = pgEnum('asset_dimension_kind', [
  'RIAL',
  'GOLD',
  'SILVER',
  'COIN',
]);

export type AssetDimensionKind = (typeof assetDimensionKindEnum.enumValues)[number];

/**
 * بعد داراییِ یک tenant.
 *
 * `tenantId` از روی قرارداد اولیه nullable است تا مدل در آینده بتواند بعد
 * platform-wide داشته باشد، ولی فاز ۱ فقط بعدهای tenant-scoped می‌سازد. RLS
 * نیز همین ردیف‌ها را در اختیار نقش برنامه می‌گذارد. بعد سکه همواره به یک
 * `coin_type` همان tenant وصل است و یکتایی مرکب، یکی کردن دو نوع سکه در یک
 * بعد را از ساختار داده ناممکن می‌کند.
 */
export const assetDimensions = pgTable(
  'asset_dimensions',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid().references(() => tenants.id, { onDelete: 'cascade' }),
    code: text().notNull(),
    kind: assetDimensionKindEnum().notNull(),
    coinTypeId: uuid(),
    title: text().notNull(),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.coinTypeId],
      foreignColumns: [coinTypes.tenantId, coinTypes.id],
      name: 'asset_dimensions_tenant_coin_type_fk',
    }).onDelete('cascade'),

    check('asset_dimensions_code_nonblank_check', sql`length(btrim(${table.code})) > 0`),
    check('asset_dimensions_title_nonblank_check', sql`length(btrim(${table.title})) > 0`),
    check(
      'asset_dimensions_coin_identity_check',
      sql`(${table.kind} = 'COIN') = (${table.coinTypeId} IS NOT NULL)`,
    ),
    check(
      'asset_dimensions_coin_tenant_check',
      sql`${table.kind} <> 'COIN' OR ${table.tenantId} IS NOT NULL`,
    ),

    /* کلید مرکب لازم است تا tableهای tenant-scoped بعداً بتوانند FK هم‌مستأجر بگیرند. */
    unique('asset_dimensions_tenant_id_id_unique').on(table.tenantId, table.id),
    uniqueIndex('asset_dimensions_tenant_code_unique').on(table.tenantId, table.code),
    uniqueIndex('asset_dimensions_tenant_coin_type_unique').on(
      table.tenantId,
      table.coinTypeId,
    ),
  ],
);

export type AssetDimension = typeof assetDimensions.$inferSelect;
