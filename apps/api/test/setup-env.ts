/**
 * محیط تست.
 *
 * تست‌ها هم مثل production محیط معتبر لازم دارند — همین که این فایل وجود دارد
 * یعنی «اجباری بودن» واقعی است، نه تعارف. مقادیر با `??=` گذاشته می‌شوند تا
 * اگر کسی روی دیتابیس واقعی تست می‌گیرد، محیط خودش بازنویسی نشود.
 *
 * این‌ها مقدار تستی‌اند و هیچ‌کجا به سیستم واقعی وصل نمی‌شوند.
 */
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://gold:gold@localhost:5432/gold_test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-that-is-long-enough-32';
/*
 * خط پایانی هر درخواست در سطح info است؛ صدها درخواست تست خروجی را غرق می‌کند.
 * فقط خطاهای واقعی (۵۰۰) دیده می‌شوند — همان رفتار پیش از BE-067.
 */
process.env.LOG_LEVEL ??= 'error';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-that-is-long-enough-32';
