import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { assetDimensions } from './asset-dimensions';
import { coinTypes } from './coin-types';
import { jewelryItems } from './jewelry-items';
import { tenants } from './tenants';

/**
 * چیزی که موجودی از آن جابه‌جا می‌شود — فاز ۱.
 *
 * سکه عمداً یک نوع مستقل است و به گرم تبدیل نمی‌شود (قاعده‌ی ۲-۲): اگر
 * ۵ سکه به‌صورت ۳۶٫۶ گرم ذخیره شود، موقعیت حبابی کاربر ناپدید می‌شود.
 */
export const inventoryItemTypeEnum = pgEnum('inventory_item_type', [
  'JEWELRY',
  'MELTED_GOLD',
  'COIN',
]);

/**
 * سندی که حرکت را ساخته است.
 *
 * فهرست عمداً بسته است. هر جریان جدیدی که موجودی را تکان می‌دهد باید
 * صریح اینجا اضافه شود، وگرنه یک مقدار آزاد متنی به‌مرور به سطل زباله‌ی
 * «چرا این ۳ گرم کم شد؟» تبدیل می‌شود.
 */
export const inventoryMovementSourceTypeEnum = pgEnum('inventory_movement_source_type', [
  'OPENING_BALANCE',
  'SALE',
  'PURCHASE',
  'SECOND_HAND_PURCHASE',
  'SETTLEMENT',
  'CORRECTION',
]);

export type InventoryItemType = (typeof inventoryItemTypeEnum.enumValues)[number];
export type InventoryMovementSourceType =
  (typeof inventoryMovementSourceTypeEnum.enumValues)[number];

/**
 * دفتر حرکات موجودی — Append-Only، BE-027.
 *
 * ## واحد `quantity` به `item_type` بستگی دارد
 *
 * | نوع | واحد | `item_id` |
 * |---|---|---|
 * | `JEWELRY` | تعداد قطعه | `jewelry_items.id` |
 * | `COIN` | تعداد | `coin_types.id` |
 * | `MELTED_GOLD` | میلی‌گرم طلای خالص ۱۰۰۰ | `NULL` |
 *
 * آبشده شناسه‌ی کالا ندارد چون هویت مستقلی ندارد: هر عیاری که وارد شود،
 * به وزن خالص ۱۰۰۰ تبدیل و با بقیه جمع می‌شود. همان قاعده‌ی ۲-۱.
 *
 * ستون یکی است و `bigint`، چون هر سه واحد عدد صحیح دقیق‌اند — همان
 * تصمیمی که BE-032 برای `ledger_entries` می‌گیرد: «سکه در API عدد صحیح
 * است و در storage سازگار ذخیره می‌شود».
 *
 * علامت، جهت را می‌سازد: ورودی مثبت، خروجی منفی. موجودی جاری مجموع
 * ردیف‌هاست و هیچ‌جا به‌صورت ستون cache نمی‌شود.
 *
 * ## کلید خارجیِ `item_id` چندریختی
 *
 * ارجاع چندریختی است و به دو جدول مختلف می‌رود، پس خود `item_id` کلید
 * خارجی نمی‌گیرد. یک check constraint تضمین می‌کند شناسه دقیقاً برای همان
 * نوع‌هایی وجود دارد که باید، و از BE-063 دو ستون generated
 * (`jewelry_item_id`، `coin_type_id`) همان شناسه را بر حسب نوع جدا می‌کنند
 * تا هر کدام کلید خارجی هم‌مستأجرِ واقعی بگیرند — حرکتی به کالا یا سکه‌ی
 * ناموجود حتی با SQL مستقیم هم ثبت نمی‌شود. همخوانی نوع کالا با نوع بُعد
 * (سکه فقط روی بُعد همان سکه، بقیه روی بُعد طلا) با تریگر مهاجرت ۰۰۳۲ است.
 */
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceType: inventoryMovementSourceTypeEnum().notNull(),
    /**
     * سند مسبب حرکت. `NOT NULL` است تا هیچ حرکتی بی‌علت نماند؛ موجودی‌ای
     * که نشود توضیحش داد، همان چیزی است که اعتماد کاربر را می‌برد.
     */
    sourceId: uuid().notNull(),
    itemType: inventoryItemTypeEnum().notNull(),
    itemId: uuid(),
    /** فقط برای کلید خارجی؛ مقدارش را دیتابیس از `item_id` می‌سازد. */
    jewelryItemId: uuid().generatedAlwaysAs(
      sql`CASE WHEN "item_type" = 'JEWELRY' THEN "item_id" END`,
    ),
    /** فقط برای کلید خارجی؛ مقدارش را دیتابیس از `item_id` می‌سازد. */
    coinTypeId: uuid().generatedAlwaysAs(sql`CASE WHEN "item_type" = 'COIN' THEN "item_id" END`),
    /** بُعد قطعی همین حرکت؛ با کلید خارجی هم‌مستأجر محافظت می‌شود. */
    dimensionId: uuid().notNull(),
    quantity: bigint({ mode: 'bigint' }).notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.dimensionId],
      foreignColumns: [assetDimensions.tenantId, assetDimensions.id],
      name: 'inventory_movements_tenant_dimension_fk',
    }).onDelete('restrict'),
    /*
     * مهاجرت ۰۰۳۲ این دو را DEFERRABLE INITIALLY DEFERRED می‌کند تا حذف
     * مستأجر — که کالا و حرکت را از دو شاخه‌ی cascade جدا می‌برد — به ترتیب
     * پردازش شاخه‌ها حساس نباشد.
     */
    foreignKey({
      columns: [table.tenantId, table.jewelryItemId],
      foreignColumns: [jewelryItems.tenantId, jewelryItems.id],
      name: 'inventory_movements_tenant_jewelry_item_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.coinTypeId],
      foreignColumns: [coinTypes.tenantId, coinTypes.id],
      name: 'inventory_movements_tenant_coin_type_fk',
    }),
    /*
     * حرکت صفر یعنی هیچ اتفاقی نیفتاده. اجازه دادنش فقط دفتر را با
     * ردیف‌هایی پر می‌کند که موجودی را عوض نمی‌کنند ولی موقع بررسی
     * اختلاف، وقت آدم را می‌گیرند.
     */
    check('inventory_movements_quantity_nonzero_check', sql`${table.quantity} <> 0`),
    /*
     * آبشده شناسه ندارد و آن دو نوع دیگر حتماً دارند. بدون این، یک
     * حرکتِ زیورآلات بدون شناسه وارد می‌شد و موجودی هیچ کالایی را
     * تکان نمی‌داد — خطایی که فقط موقع انبارگردانی پیدا می‌شد.
     */
    check(
      'inventory_movements_item_identity_check',
      sql`(${table.itemType} = 'MELTED_GOLD') = (${table.itemId} IS NULL)`,
    ),

    index('inventory_movements_balance_idx').on(table.tenantId, table.itemType, table.itemId),
    index('inventory_movements_source_idx').on(table.tenantId, table.sourceType, table.sourceId),
    index('inventory_movements_occurred_at_idx').on(table.tenantId, table.occurredAt),
  ],
);

export type InventoryMovement = typeof inventoryMovements.$inferSelect;
