/**
 * فهرست کامل جدول‌های دیتابیس.
 *
 * **قرارداد ساختاری:** schema فیزیکی متمرکز است، رفتار ماژولار.
 * یعنی تعریف جدول‌ها همه اینجا جمع می‌شوند و منطق دامنه در ماژول خودش
 * می‌ماند (`platform/tenant/`، `modules/ledger/`، …).
 *
 * دلیلش این است که کارهای بعدی ذاتاً روی **همه‌ی** جدول‌ها عمل می‌کنند و
 * به یک فهرست واحد نیاز دارند: helper مهاجرت RLS در BE-009، تریگر تراز
 * دفتر کل در BE-033، و محدودیت‌های سراسری در BE-063. اگر تعریف‌ها در
 * ماژول‌ها پخش بودند، drizzle-kit و آن helperها باید همه‌جا را می‌گشتند.
 *
 * جهت وابستگی هم سالم می‌ماند: فایل‌های اینجا فقط به `drizzle-orm` وابسته‌اند
 * و به هیچ ماژولی import نمی‌دهند، پس چرخه‌ای ساخته نمی‌شود.
 */
export * from './migration-probes';
export * from './refresh-tokens';
export * from './rls-probes';
export * from './roles';
export * from './tenant-memberships';
export * from './tenants';
export * from './users';
