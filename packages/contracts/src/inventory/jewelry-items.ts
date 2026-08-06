import { z } from 'zod';
import {
  isoDateTimeSchema,
  nonNegativeBigIntStringSchema,
  paginatedSchema,
  paginationQuerySchema,
  positiveBigIntStringSchema,
  uuidSchema,
} from '../common/index.js';

export const jewelryWageTypeSchema = z.enum(['PER_GRAM', 'PERCENT_X100', 'FLAT']);

/**
 * عیار عدد صحیح کوچک است، پس `number` اینجا بی‌خطر است — برخلاف وزن و
 * مبلغ که از محدوده‌ی امن `number` رد می‌شوند و رشته می‌مانند.
 */
export const karatSchema = z.number().int().min(1).max(1000);

/**
 * مشخصات نسخه‌دار کالای زیورآلات — BE-025.
 *
 * همه‌ی وزن‌ها رشته‌ی میلی‌گرم صحیح‌اند. مقدار اعشاری اینجا رد می‌شود، نه
 * گرد: `"12.5"` یعنی کلاینت گرم فرستاده به‌جای میلی‌گرم، و پذیرفتنش
 * وزن را ۱۰۰۰ برابر غلط می‌کرد.
 *
 * وزن خالص عمداً در قرارداد نیست: مشتق سه فیلد دیگر و عیار است و
 * `articlePureMg` در `core-calc` محاسبه‌اش می‌کند. فرستادنش روی سیم یعنی
 * کلاینت بتواند مقداری ناسازگار با اجزایش بدهد.
 */
export const jewelryItemVersionSchema = z.object({
  id: uuidSchema,
  jewelryItemId: uuidSchema,
  code: z.string().min(1),
  title: z.string().min(1),
  grossWeightMg: positiveBigIntStringSchema,
  karat: karatSchema,
  stoneWeightMg: nonNegativeBigIntStringSchema,
  otherDeductionWeightMg: nonNegativeBigIntStringSchema,
  wageType: jewelryWageTypeSchema,
  wageValue: nonNegativeBigIntStringSchema,
  validFrom: z.string().datetime({ offset: true }),
  validTo: z.string().datetime({ offset: true }).nullable(),
  version: z.number().int().positive(),
  active: z.boolean(),
});

/*
 * کرانه‌های طول متن — مرز فنی API‌اند، نه عدد صنفی. قاعده‌ی ۲-۶ درباره‌ی
 * اعداد دامنه‌ی طلاست (عیار، نرخ مالیات، مشخصات سکه)؛ این‌ها فقط جلوی
 * ورودی غول‌پیکر را می‌گیرند.
 */
const MAX_CODE_LENGTH = 64;
const MAX_TITLE_LENGTH = 200;
const MAX_SEARCH_LENGTH = 100;

const jewelryCodeSchema = z.string().min(1).max(MAX_CODE_LENGTH);
const jewelryTitleSchema = z.string().min(1).max(MAX_TITLE_LENGTH);

/**
 * مشخصاتی که مبلغ فاکتور را می‌سازند.
 *
 * تغییر هرکدامشان در BE-026 **نسخه‌ی جدید** می‌سازد و نسخه‌ی قبلی دست
 * نمی‌خورد — قاعده‌ی ۲-۶: فاکتور دو ماه پیش باید امروز همان اعداد را
 * بازتولید کند. `title` عمداً بیرون این مجموعه است.
 */
const financialSpecificationShape = {
  grossWeightMg: positiveBigIntStringSchema,
  karat: karatSchema,
  stoneWeightMg: nonNegativeBigIntStringSchema,
  otherDeductionWeightMg: nonNegativeBigIntStringSchema,
  wageType: jewelryWageTypeSchema,
  wageValue: nonNegativeBigIntStringSchema,
};

/**
 * ورودی `POST /inventory/jewelry-items`.
 *
 * `validFrom` اختیاری است و نبودنش یعنی «از همین حالا». وزن کسورات
 * پیش‌فرض صفر دارد چون بیشتر کالاها نگین ندارند و اجبار به فرستادن `"0"`
 * فقط ثبت را کند می‌کند.
 */
export const createJewelryItemSchema = z
  .object({
    code: jewelryCodeSchema,
    title: jewelryTitleSchema,
    ...financialSpecificationShape,
    stoneWeightMg: nonNegativeBigIntStringSchema.default('0'),
    otherDeductionWeightMg: nonNegativeBigIntStringSchema.default('0'),
    validFrom: isoDateTimeSchema.optional(),
  })
  .strict();

/**
 * ورودی `PATCH /inventory/jewelry-items/:id`.
 *
 * `code` اینجا نیست: کد انبار هویت کالاست و در `jewelry_items` می‌ماند،
 * نه در نسخه‌ها. تغییرش یعنی کالای دیگری، نه نسخه‌ی دیگری.
 */
export const updateJewelryItemSchema = z
  .object({
    title: jewelryTitleSchema.optional(),
    grossWeightMg: positiveBigIntStringSchema.optional(),
    karat: karatSchema.optional(),
    stoneWeightMg: nonNegativeBigIntStringSchema.optional(),
    otherDeductionWeightMg: nonNegativeBigIntStringSchema.optional(),
    wageType: jewelryWageTypeSchema.optional(),
    wageValue: nonNegativeBigIntStringSchema.optional(),
    /** فقط وقتی معنا دارد که مشخصات مالی عوض شوند — شروع اعتبار نسخه‌ی جدید. */
    validFrom: isoDateTimeSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'حداقل یک فیلد برای تغییر لازم است');

/**
 * پارامترهای فهرست کالا.
 *
 * `active` رشته‌ی `"true"`/`"false"` است و نه `coerce.boolean()`:
 * `Boolean("false")` در جاوااسکریپت `true` می‌شود و فیلتر «غیرفعال‌ها»
 * بی‌صدا به «همه» تبدیل می‌شد.
 */
export const jewelryItemQuerySchema = paginationQuerySchema
  .extend({
    search: z.string().min(1).max(MAX_SEARCH_LENGTH).optional(),
    active: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .strict();

/** پارامتر `GET /inventory/jewelry-items/:id` — نسخه‌ی مؤثر در یک لحظه‌ی گذشته. */
export const jewelryItemDetailQuerySchema = z
  .object({
    at: isoDateTimeSchema.optional(),
  })
  .strict();

export const jewelryItemListSchema = paginatedSchema(jewelryItemVersionSchema);

export type CreateJewelryItemInput = z.infer<typeof createJewelryItemSchema>;
export type UpdateJewelryItemInput = z.infer<typeof updateJewelryItemSchema>;
export type JewelryItemQuery = z.infer<typeof jewelryItemQuerySchema>;
export type JewelryItemDetailQuery = z.infer<typeof jewelryItemDetailQuerySchema>;
export type JewelryItemList = z.infer<typeof jewelryItemListSchema>;
export type JewelryWageType = z.infer<typeof jewelryWageTypeSchema>;
export type JewelryItemVersion = z.infer<typeof jewelryItemVersionSchema>;
