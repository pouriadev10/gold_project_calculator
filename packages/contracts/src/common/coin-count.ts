import { z } from 'zod';

/**
 * بیشینه‌ی تعداد سکه در یک سند — سقف ستون `integer` (int4) ِ PostgreSQL.
 *
 * مرز فنی ذخیره‌سازی است، نه عدد صنفی: تعداد سکه‌ی سطر فاکتور
 * (`sales_invoice_items.quantity`) و خرید (`second_hand_purchase_items.coin_count`)
 * int4 است. بدون این سقف، `z.number().int()` حتی `1e20` را می‌پذیرفت؛ مقدار به
 * INSERT می‌رسید و خطای `22003` ِ پستگرس به‌جای ۴۰۰ پاسخ ۵۰۰ می‌داد (و فراتر از
 * `Number.MAX_SAFE_INTEGER` تعداد اصلاً دقیق نمی‌ماند).
 */
export const MAX_COIN_COUNT = 2_147_483_647;

/** تعداد سکه‌ی یک سطر ورودی — عدد صحیح شمارشی، هرگز وزن (قاعده‌ی ۲-۲). */
export const coinCountSchema = z
  .number()
  .int('تعداد سکه باید عدد صحیح باشد')
  .positive('تعداد سکه باید بزرگ‌تر از صفر باشد')
  .max(MAX_COIN_COUNT, 'تعداد سکه از بیشینه‌ی مجاز بیشتر است');
