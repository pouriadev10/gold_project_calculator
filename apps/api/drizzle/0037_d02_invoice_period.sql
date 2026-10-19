-- D-02 — شماره‌ی فاکتور سالانه با سال در شناسه.
--
-- شمارنده‌ی فاکتور هر سال جلالی از ۱ شروع می‌شود (BE-038)، ولی یکتایی فقط
-- (tenant_id, invoice_number) بود: اولین فروش ۱ فروردین ۱۴۰۶ شماره‌ی ۱ ِ پارسال را
-- می‌گرفت و با 23505 رد می‌شد. حالا دوره (سال جلالی) روی خود فاکتور ذخیره و جزء
-- یکتایی و شناسه‌ی نمایشی («1405-12») است.
ALTER TABLE "sales_invoices" ADD COLUMN "invoice_period" text;--> statement-breakpoint
-- پر کردن دوره‌ی فاکتورهای موجود: سال جلالی ِ تاریخ محلی finalize در منطقه‌ی زمانی مستأجر.
-- جدول آغاز سال (۱ فروردین) از همان تقویم ICU ساخته شده که runtime با Intl استفاده
-- می‌کند. تاریخی بیرون از این بازه NULL می‌ماند و check ِ پایین مهاجرت را با صدا می‌شکند.
-- نگهبان سربرگ نهایی (0036) فقط برای همین پر کردن یک‌باره خاموش می‌شود.
ALTER TABLE "sales_invoices" DISABLE TRIGGER "sales_invoices_restrict_finalized_update";--> statement-breakpoint
UPDATE "sales_invoices" AS si
SET "invoice_period" = (
  SELECT n.jalali_year
  FROM (
    VALUES
      ('1390', DATE '2011-03-21'),
      ('1391', DATE '2012-03-20'),
      ('1392', DATE '2013-03-21'),
      ('1393', DATE '2014-03-21'),
      ('1394', DATE '2015-03-21'),
      ('1395', DATE '2016-03-20'),
      ('1396', DATE '2017-03-21'),
      ('1397', DATE '2018-03-21'),
      ('1398', DATE '2019-03-21'),
      ('1399', DATE '2020-03-20'),
      ('1400', DATE '2021-03-21'),
      ('1401', DATE '2022-03-21'),
      ('1402', DATE '2023-03-21'),
      ('1403', DATE '2024-03-20'),
      ('1404', DATE '2025-03-21'),
      ('1405', DATE '2026-03-21'),
      ('1406', DATE '2027-03-21'),
      ('1407', DATE '2028-03-20'),
      ('1408', DATE '2029-03-20'),
      ('1409', DATE '2030-03-21'),
      ('1410', DATE '2031-03-21'),
      ('1411', DATE '2032-03-20'),
      ('1412', DATE '2033-03-20'),
      ('1413', DATE '2034-03-21'),
      ('1414', DATE '2035-03-21'),
      ('1415', DATE '2036-03-20'),
      ('1416', DATE '2037-03-20'),
      ('1417', DATE '2038-03-21'),
      ('1418', DATE '2039-03-21'),
      ('1419', DATE '2040-03-20'),
      ('1420', DATE '2041-03-20'),
      ('1421', DATE '2042-03-21'),
      ('1422', DATE '2043-03-21'),
      ('1423', DATE '2044-03-20'),
      ('1424', DATE '2045-03-20'),
      ('1425', DATE '2046-03-21'),
      ('1426', DATE '2047-03-21'),
      ('1427', DATE '2048-03-20'),
      ('1428', DATE '2049-03-20'),
      ('1429', DATE '2050-03-21'),
      ('1430', DATE '2051-03-21')
  ) AS n(jalali_year, starts_on)
  WHERE n.starts_on <= (si."finalized_at" AT TIME ZONE t."timezone")::date
  ORDER BY n.starts_on DESC
  LIMIT 1
)
FROM "tenants" AS t
WHERE t."id" = si."tenant_id" AND si."invoice_number" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoices" ENABLE TRIGGER "sales_invoices_restrict_finalized_update";--> statement-breakpoint
DROP INDEX "sales_invoices_tenant_number_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_tenant_period_number_unique" ON "sales_invoices" USING btree ("tenant_id","invoice_period","invoice_number");--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_period_with_number_check" CHECK (("sales_invoices"."invoice_period" IS NULL) = ("sales_invoices"."invoice_number" IS NULL));--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_period_format_check" CHECK ("sales_invoices"."invoice_period" IS NULL OR "sales_invoices"."invoice_period" ~ '^[0-9]{4}$');--> statement-breakpoint
-- منطقه‌ی زمانی مستأجر جاری، برای مرز سال شماره‌گذاری داخل تراکنش مستأجر.
-- نقش gold_app عمداً به جدول سراسری tenants دسترسی ندارد (BE-065)؛ این تابع فقط
-- timezone ِ همان مستأجری را برمی‌گرداند که RLS برایش تنظیم شده، نه هیچ ستون یا ردیف دیگری.
CREATE OR REPLACE FUNCTION current_tenant_timezone() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT "timezone" FROM "tenants" WHERE "id" = current_tenant_id()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION current_tenant_timezone() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION current_tenant_timezone() TO gold_app;
