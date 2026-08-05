-- BE-026 — کلید جست‌وجوی عنوان کالای زیورآلات.
--
-- ستون NOT NULL در سه گام اضافه می‌شود و نه یک‌جا: `ADD COLUMN ... NOT NULL`
-- روی جدولی که ردیف دارد بلافاصله می‌شکند.
--
-- مقدار پرکردن ردیف‌های قبلی عمداً تقریبی است (`lower(btrim(title))`) و
-- قواعد کامل `searchKey` را در SQL بازنویسی نمی‌کند. جدول امروز فقط
-- داده‌ی تست دارد، و از این مهاجرت به بعد هر نوشتنی از مسیر
-- `normalizeTextForSearch` می‌گذرد که مالکش `core-calc` است. تکرار آن
-- قواعد اینجا یعنی دو منبع حقیقت برای چیزی که فقط یک بار اجرا می‌شود.
ALTER TABLE "jewelry_item_versions" ADD COLUMN "normalized_title" text;--> statement-breakpoint
UPDATE "jewelry_item_versions" SET "normalized_title" = lower(btrim("title")) WHERE "normalized_title" IS NULL;--> statement-breakpoint
ALTER TABLE "jewelry_item_versions" ALTER COLUMN "normalized_title" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "jewelry_item_versions_tenant_normalized_title_idx" ON "jewelry_item_versions" USING btree ("tenant_id","normalized_title");
