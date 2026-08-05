import { z } from 'zod';
import { bigIntStringSchema, isoDateTimeSchema, uuidSchema } from '../common/index.js';

/**
 * نوع کالای موجودی — BE-027.
 *
 * سکه یک نوع مستقل است و هرگز به وزن تبدیل نمی‌شود (قاعده‌ی ۲-۲).
 */
export const inventoryItemTypeSchema = z.enum(['JEWELRY', 'MELTED_GOLD', 'COIN']);

/** سندی که حرکت موجودی را ساخته است. فهرست بسته است، نه متن آزاد. */
export const inventoryMovementSourceTypeSchema = z.enum([
  'OPENING_BALANCE',
  'SALE',
  'PURCHASE',
  'CORRECTION',
]);

/**
 * مقدار حرکت یا مانده — رشته‌ی عدد صحیح **علامت‌دار**.
 *
 * واحدش به نوع کالا بستگی دارد: تعداد قطعه برای زیورآلات، تعداد برای
 * سکه، و میلی‌گرم طلای خالص ۱۰۰۰ برای آبشده. رشته است چون مجموع
 * میلی‌گرم یک انبار واقعی از محدوده‌ی امن `number` رد می‌شود.
 */
export const inventoryQuantitySchema = bigIntStringSchema;

export const inventoryMovementSchema = z.object({
  id: uuidSchema,
  sourceType: inventoryMovementSourceTypeSchema,
  sourceId: uuidSchema,
  itemType: inventoryItemTypeSchema,
  /** برای آبشده `null` است: هویت مستقلی ندارد و با وزن خالص دنبال می‌شود. */
  itemId: uuidSchema.nullable(),
  dimensionId: uuidSchema.nullable(),
  quantity: inventoryQuantitySchema,
  occurredAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
});

export const inventoryBalanceSchema = z.object({
  itemType: inventoryItemTypeSchema,
  itemId: uuidSchema.nullable(),
  quantity: inventoryQuantitySchema,
});

export type InventoryItemType = z.infer<typeof inventoryItemTypeSchema>;
export type InventoryMovementSourceType = z.infer<typeof inventoryMovementSourceTypeSchema>;
export type InventoryMovement = z.infer<typeof inventoryMovementSchema>;
export type InventoryBalance = z.infer<typeof inventoryBalanceSchema>;
