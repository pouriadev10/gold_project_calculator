import { sql } from 'drizzle-orm';
import { bigint, check, index, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
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
 * ## چرا کلید خارجی روی `item_id` نیست
 *
 * ارجاع چندریختی است و به سه جدول مختلف می‌رود. به‌جای کلید خارجی، یک
 * check constraint تضمین می‌کند شناسه دقیقاً برای همان نوع‌هایی وجود
 * دارد که باید.
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
    /**
     * بُعد دفتر کل. فعلاً بدون کلید خارجی و nullable است، چون جدول
     * `asset_dimensions` در BE-030 ساخته می‌شود؛ کلید خارجی و `NOT NULL`
     * همان‌جا اضافه می‌شوند.
     */
    dimensionId: uuid(),
    quantity: bigint({ mode: 'bigint' }).notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
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
