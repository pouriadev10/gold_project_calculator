import { z } from 'zod';

/**
 * حد بالای اندازه‌ی صفحه. مرز فنی API است، نه عدد صنفی — بنابراین اینجا
 * ثابت است و لازم نیست رکورد نسخه‌دار دیتابیسی باشد (قاعده‌ی ۲-۶ فقط
 * درباره‌ی اعداد دامنه‌ی طلاست: عیار، نرخ مالیات، مشخصات سکه).
 */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

/**
 * پارامترهای صفحه‌بندی. `coerce` لازم است چون query string همیشه رشته می‌رسد؛
 * این دو شمارنده‌اند نه پول یا وزن، پس `number` اینجا بی‌خطر است.
 */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** پوسته‌ی پاسخ فهرستی. `total` تعداد کل پیش از صفحه‌بندی است. */
export function paginatedSchema<TItem extends z.ZodTypeAny>(item: TItem) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  });
}

export interface Paginated<TItem> {
  items: TItem[];
  total: number;
  limit: number;
  offset: number;
}
