/**
 * قرارداد API — منبع واحد حقیقت میان `apps/web` و `apps/api`.
 *
 * این پکیج عمداً به NestJS، Drizzle و React وابسته نیست و هیچ نوع مربوط به
 * دیتابیس ندارد. تنها وابستگی‌اش Zod است، تا همان schema هم سمت سرور
 * اعتبارسنجی کند و هم سمت مرورگر فرم را بسنجد.
 *
 * دو قاعده‌ی حاکم بر همه‌ی قراردادهای اینجا:
 *
 * ۱. هیچ مقدار پولی یا وزنی `number` نیست — همه رشته‌ی عدد صحیح‌اند.
 * ۲. سکه شمارشی است، نه وزنی. هرگز در قرارداد به گرم تبدیل نمی‌شود.
 */
export * from './common/index.js';
export * from './auth/index.js';
export * from './pricing/index.js';
export * from './parties/index.js';
export * from './inventory/index.js';
export * from './ledger/index.js';
export * from './sales/index.js';
export * from './purchase/index.js';
export * from './settlement/index.js';
export * from './reporting/index.js';
