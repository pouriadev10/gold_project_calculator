-- پیش‌نیاز restore روی سرور PostgreSQL تازه — BE-068.
--
-- `pg_dump` یک دیتابیس را می‌گیرد، نه کل cluster. نقش‌ها (roles) سراسری‌اند و
-- داخل فایل backup نیستند؛ ولی همان فایل GRANTها و policyهای RLS را به نقش
-- `gold_app` دارد. اگر این نقش وجود نداشته باشد `pg_restore --exit-on-error`
-- روی اولین GRANT متوقف می‌شود — و اگر بدون آن پرچم اجرا شود، بدتر: دیتابیس
-- بی‌صدا بدون مجوزهای نقش برنامه بالا می‌آید و API روی اولین درخواست می‌شکند.
--
-- تعریف نقش عیناً همان migration `0003_tenant_rls.sql` است. اجرای دوباره بی‌خطر است.
--
--   psql -U gold -d postgres -v ON_ERROR_STOP=1 -f restore-prerequisites.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gold_app') THEN
    CREATE ROLE gold_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

-- کاربر اتصال برنامه با `SET LOCAL ROLE gold_app` وارد RLS می‌شود و برای آن
-- باید عضو نقش باشد. عضویت هم سراسری است و در backup نمی‌آید.
GRANT gold_app TO CURRENT_USER;
