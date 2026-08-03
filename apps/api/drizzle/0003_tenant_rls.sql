-- BE-009 — زیرساخت Row-Level Security.
--
-- چرا اصلاً نقش جداگانه لازم است: PostgreSQL سیاست‌های RLS را برای
-- سوپرکاربر، نقش‌های BYPASSRLS و مالک جدول **نادیده می‌گیرد**. کاربر
-- `gold` در محیط توسعه هر سه‌تاست. یعنی بدون یک نقش محدود، می‌شود RLS را
-- فعال کرد، سیاست نوشت، و همه‌چیز سبز به نظر برسد در حالی که هیچ
-- جداسازی‌ای وجود ندارد. این خطرناک‌ترین حالت ممکن است: امنیتِ ظاهری.

-- ── نقش اجرای برنامه ────────────────────────────────────────────────
-- NOLOGIN است چون هرگز مستقیم به آن وصل نمی‌شویم؛ تراکنش‌های داده‌ی
-- مستأجر با `SET LOCAL ROLE` به آن سوئیچ می‌کنند و در پایان تراکنش
-- خودبه‌خود برمی‌گردند.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gold_app') THEN
    CREATE ROLE gold_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint

-- اگر کاربر مهاجرت سوپرکاربر نباشد، بدون این عضویت نمی‌تواند
-- `SET LOCAL ROLE gold_app` بزند.
DO $$
BEGIN
  EXECUTE format('GRANT gold_app TO %I', CURRENT_USER);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
--> statement-breakpoint

-- ── مستأجر جاری ─────────────────────────────────────────────────────
-- پارامتر دوم `true` یعنی «اگر تنظیم نشده خطا نده، NULL بده».
-- نتیجه‌اش این است که در نبودِ مستأجر، شرط سیاست به NULL می‌رسد و هیچ
-- ردیفی دیده نمی‌شود — خرابی در جهت بسته، نه باز.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
  LANGUAGE sql
  STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
$$;
--> statement-breakpoint

-- ── helper فعال‌سازی RLS ────────────────────────────────────────────
-- هر جدول داده‌ی مستأجر از BE-023 به بعد فقط یک خط لازم دارد:
--   SELECT enable_tenant_rls('parties');
--
-- `FORCE` حیاتی است: بدون آن، مالک جدول (همان کاربری که مهاجرت را اجرا
-- کرده) از سیاست معاف می‌ماند.
CREATE OR REPLACE FUNCTION enable_tenant_rls(target regclass) RETURNS void
  LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', target);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
    target
  );
END;
$$;
--> statement-breakpoint

-- ── دسترسی‌های نقش برنامه ───────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO gold_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gold_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gold_app;
--> statement-breakpoint

-- جدول‌هایی که مهاجرت‌های بعدی می‌سازند هم خودکار همین دسترسی را بگیرند،
-- وگرنه اولین جدول جدید بی‌صدا برای نقش برنامه غیرقابل‌دسترس می‌شود.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gold_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO gold_app;
--> statement-breakpoint

-- ── اعمال روی جدول کارآزمایی ────────────────────────────────────────
SELECT enable_tenant_rls('rls_probes');
