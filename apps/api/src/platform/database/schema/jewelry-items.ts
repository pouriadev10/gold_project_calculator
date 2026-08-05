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
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * نحوه‌ی محاسبه‌ی اجرت.
 *
 * - `PER_GRAM` — مبلغ ریالی به ازای هر گرمِ وزن قابل محاسبه.
 * - `PERCENT_X100` — درصدی از ارزش طلا، در مقیاس ۱۰۰ (یعنی ۷٪ = ۷۰۰).
 *   مقیاس صحیح است نه اعشاری، چون قاعده‌ی ۲-۱ اجازه‌ی شناور نمی‌دهد و
 *   اجرت‌های بازار تا دو رقم اعشار می‌روند.
 * - `FLAT` — مبلغ ثابت ریالی برای کل کالا.
 */
export const jewelryWageTypeEnum = pgEnum('jewelry_wage_type', [
  'PER_GRAM',
  'PERCENT_X100',
  'FLAT',
]);

export type JewelryWageType = (typeof jewelryWageTypeEnum.enumValues)[number];

/**
 * هویت پایدار یک کالای زیورآلات.
 *
 * فقط چیزهایی اینجا می‌مانند که در طول عمر کالا **تغییر نمی‌کنند**:
 * شناسه و کد انبار. هر مشخصه‌ای که روی مبلغ فاکتور اثر دارد — وزن،
 * عیار، اجرت — در `jewelry_item_versions` است، چون قاعده‌ی ۲-۶ می‌گوید
 * فاکتور دو ماه پیش باید امروز همان اعداد را بازتولید کند.
 */
export const jewelryItems = pgTable(
  'jewelry_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('jewelry_items_tenant_code_unique').on(table.tenantId, table.code),
    /*
     * کلید مرکب، تا نسخه‌ها با همان مستأجر به کالا ارجاع دهند و ارجاع
     * بین‌مستأجری از نظر ساختاری ناممکن باشد.
     *
     * `unique()` است و نه `uniqueIndex()`: اولی داخل خودِ `CREATE TABLE`
     * می‌نشیند، دومی یک `CREATE UNIQUE INDEX` جدا **بعد از** افزودن
     * کلیدهای خارجی تولید می‌کند — و آن‌وقت کلید خارجیِ نسخه‌ها به
     * ستون‌هایی ارجاع می‌دهد که هنوز یکتا نیستند و مهاجرت می‌شکند.
     */
    unique('jewelry_items_tenant_id_id_unique').on(table.tenantId, table.id),
  ],
);

/**
 * مشخصات نسخه‌دار کالا.
 *
 * وزن‌ها همه `bigint` میلی‌گرم‌اند (قاعده‌ی ۲-۱). عیار عدد صحیح ۱ تا
 * ۱۰۰۰ است و همین را دیتابیس هم اجبار می‌کند، نه فقط لایه‌ی برنامه.
 *
 * وزن خالص ستون نیست و ذخیره نمی‌شود: مشتق وزن ناخالص، کسورات و عیار
 * است و `articlePureMg` در `core-calc` محاسبه‌اش می‌کند. ستون کردنش
 * یعنی دو منبع حقیقت که روزی از هم واگرا می‌شوند.
 */
export const jewelryItemVersions = pgTable(
  'jewelry_item_versions',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid().notNull(),
    jewelryItemId: uuid().notNull(),
    title: text().notNull(),
    grossWeightMg: bigint({ mode: 'bigint' }).notNull(),
    karat: integer().notNull(),
    /*
     * پیش‌فرض با `sql` نوشته شده و نه `0n`: drizzle-kit موقع تولید
     * مهاجرت نمی‌تواند BigInt را سریالایز کند و با TypeError می‌ترکد.
     */
    stoneWeightMg: bigint({ mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    otherDeductionWeightMg: bigint({ mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    wageType: jewelryWageTypeEnum().notNull(),
    /** معنایش به `wageType` بستگی دارد؛ همیشه عدد صحیح و بدون علامت. */
    wageValue: bigint({ mode: 'bigint' }).notNull(),
    validFrom: timestamp({ withTimezone: true }).notNull(),
    validTo: timestamp({ withTimezone: true }),
    version: integer().notNull(),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.jewelryItemId],
      foreignColumns: [jewelryItems.tenantId, jewelryItems.id],
      name: 'jewelry_item_versions_tenant_item_fk',
    }).onDelete('cascade'),

    check('jewelry_item_versions_gross_weight_positive_check', sql`${table.grossWeightMg} > 0`),
    check('jewelry_item_versions_karat_range_check', sql`${table.karat} BETWEEN 1 AND 1000`),
    check('jewelry_item_versions_stone_weight_check', sql`${table.stoneWeightMg} >= 0`),
    check('jewelry_item_versions_other_deduction_check', sql`${table.otherDeductionWeightMg} >= 0`),
    check('jewelry_item_versions_wage_value_check', sql`${table.wageValue} >= 0`),
    /*
     * کسورات نمی‌توانند از وزن ناخالص بیشتر باشند. همان قاعده‌ای که
     * `chargeableGrossMg` در core-calc اعمال می‌کند، اینجا هم هست تا
     * حتی با SQL مستقیم هم ردیف بی‌معنا وارد نشود — قاعده‌ی BE-063.
     */
    check(
      'jewelry_item_versions_deduction_within_gross_check',
      sql`${table.stoneWeightMg} + ${table.otherDeductionWeightMg} <= ${table.grossWeightMg}`,
    ),
    check('jewelry_item_versions_version_positive_check', sql`${table.version} >= 1`),
    check(
      'jewelry_item_versions_valid_interval_check',
      sql`${table.validTo} IS NULL OR ${table.validTo} > ${table.validFrom}`,
    ),

    uniqueIndex('jewelry_item_versions_tenant_item_version_unique').on(
      table.tenantId,
      table.jewelryItemId,
      table.version,
    ),
    index('jewelry_item_versions_effective_lookup_idx').on(
      table.tenantId,
      table.jewelryItemId,
      table.validFrom,
    ),
  ],
);

export type JewelryItem = typeof jewelryItems.$inferSelect;
export type JewelryItemVersion = typeof jewelryItemVersions.$inferSelect;
