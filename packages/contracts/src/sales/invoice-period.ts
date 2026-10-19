import { z } from 'zod';

/**
 * دوره‌ی شماره‌گذاری فاکتور — سال جلالی چهاررقمی با ارقام لاتین (`"1405"`)، D-02.
 *
 * شمارنده‌ی فاکتور هر سال از ۱ شروع می‌شود، پس `invoiceNumber` بدون این دوره یکتا
 * نیست. هر پاسخی که شماره‌ی فاکتور دارد، دوره را هم کنارش دارد؛ شناسه‌ی نمایشی
 * («۱۴۰۵-۱۲») را `formatInvoiceNumber` ِ `@gold/core-calc` از همین دو می‌سازد.
 */
export const invoicePeriodSchema = z.string().regex(/^[0-9]{4}$/u, 'دوره‌ی فاکتور باید سال چهاررقمی باشد');

export type InvoicePeriod = z.infer<typeof invoicePeriodSchema>;
