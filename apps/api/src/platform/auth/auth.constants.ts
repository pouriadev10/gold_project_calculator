/**
 * عمر توکن‌ها.
 *
 * مرز فنی‌اند نه عدد صنفی. access عمداً کوتاه است (قاعده‌ی BE-011) چون
 * تا انقضا قابل باطل کردن نیست — هر ثانیه‌ی اضافه، پنجره‌ی سوءاستفاده از
 * توکن دزدیده‌شده را باز نگه می‌دارد. refresh بلند است ولی در دیتابیس
 * ذخیره می‌شود، پس هر لحظه می‌شود باطلش کرد.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** بایت‌های تصادفی توکن تمدید. ۳۲ بایت = ۲۵۶ بیت آنتروپی. */
export const REFRESH_TOKEN_BYTES = 32;

/** کلیدی که payload توکن روی شیء درخواست می‌نشیند. */
export const AUTH_PAYLOAD_KEY = 'goldAuthPayload';
