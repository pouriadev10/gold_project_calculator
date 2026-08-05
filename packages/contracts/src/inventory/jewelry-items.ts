import { z } from 'zod';
import {
  nonNegativeBigIntStringSchema,
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

export type JewelryWageType = z.infer<typeof jewelryWageTypeSchema>;
export type JewelryItemVersion = z.infer<typeof jewelryItemVersionSchema>;
