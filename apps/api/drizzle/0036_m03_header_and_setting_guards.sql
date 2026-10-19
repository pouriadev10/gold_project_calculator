-- M-03 (بازبینی ماژول دیتابیس) — دو شکاف در نگهبان‌های دیتابیس.
--
-- ۱. حذف کاربری که حتی یک نسخه‌ی تنظیمات ساخته بود، ممکن نبود: FK ِ
--    `versioned_settings.created_by` با ON DELETE SET NULL ستون را NULL می‌کند، ولی
--    `restrict_versioned_setting_update` هر تغییر `created_by` (و هر تغییری روی نسخه‌ی
--    بسته) را رد می‌کرد، پس کل DELETE ِ کاربر با 55000 شکست می‌خورد. حالا همان استثنایی
--    که `enforce_append_only` برای بقیه‌ی جدول‌ها دارد اینجا هم هست: فقط NULL شدن
--    سازنده، فقط از درون cascade، و هیچ ستون دیگری عوض نشود.
--
-- ۲. سربرگ فاکتور و تسویه‌ی **نهایی** با هر نقشی بازنویسی می‌شد. نرخ قفل‌شده‌ی فاکتور
--    (`quote_id` / `quote_amount_rial` / `quote_observed_at`) روی همین سربرگ است و گزارش
--    سود و تعویض واحد از آن می‌خوانند — قاعده‌ی ۲-۸: گزارش دیروز فردا نباید عدد دیگری
--    بدهد. پیش از این فقط `invoice_number` محافظت می‌شد. حالا پس از FINALIZED:
--    - فاکتور: فقط اصلاحیه — `current_version` رو به جلو و `party_id` (خطای شخص) — و
--      NULL شدن سازنده در cascade ِ حذف کاربر؛
--    - تسویه: هیچ تغییری جز همان NULL شدن سازنده.
--    پیش‌نویس (DRAFT) و حذف cascade ِ مستأجر دست‌نخورده می‌مانند.

CREATE OR REPLACE FUNCTION restrict_versioned_setting_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- حذف کاربر: فقط NULL شدن سازنده از درون FK ِ ON DELETE SET NULL.
  IF pg_trigger_depth() > 1
     AND OLD.created_by IS NOT NULL
     AND NEW.created_by IS NULL
     AND to_jsonb(NEW) - 'created_by' = to_jsonb(OLD) - 'created_by' THEN
    RETURN NEW;
  END IF;

  -- نسخه‌ی تاریخی هرگز بازنویسی نمی‌شود. تنها تغییر مجاز این است که
  -- service در همان transaction یک نسخه‌ی باز را با `valid_to` ببندد.
  IF OLD.valid_to IS NOT NULL
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.setting_key IS DISTINCT FROM OLD.setting_key
    OR NEW.value_json IS DISTINCT FROM OLD.value_json
    OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.valid_to IS NULL
    OR NEW.valid_to <= OLD.valid_from
  THEN
    RAISE EXCEPTION 'versioned setting records are immutable except for closing an open interval'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION restrict_finalized_sales_invoice_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'FINALIZED' THEN
    RETURN NEW;
  END IF;

  IF pg_trigger_depth() > 1
     AND OLD.created_by IS NOT NULL
     AND NEW.created_by IS NULL
     AND to_jsonb(NEW) - 'created_by' = to_jsonb(OLD) - 'created_by' THEN
    RETURN NEW;
  END IF;

  IF NEW.current_version < OLD.current_version
     OR to_jsonb(NEW) - 'current_version' - 'party_id'
        IS DISTINCT FROM to_jsonb(OLD) - 'current_version' - 'party_id'
  THEN
    RAISE EXCEPTION 'finalized sales invoice header is immutable except for a forward amendment version and party'
      USING ERRCODE = '55000',
        HINT = 'نرخ قفل‌شده و شماره‌ی فاکتور نهایی عوض نمی‌شوند؛ اصلاح یعنی نسخه‌ی تازه.';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION restrict_finalized_settlement_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'FINALIZED' THEN
    RETURN NEW;
  END IF;

  IF pg_trigger_depth() > 1
     AND OLD.created_by IS NOT NULL
     AND NEW.created_by IS NULL
     AND to_jsonb(NEW) - 'created_by' = to_jsonb(OLD) - 'created_by' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'finalized settlement header is immutable'
    USING ERRCODE = '55000',
      HINT = 'اصلاح یعنی سند تازه، نه بازنویسی ردیف قبلی.';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sales_invoices_restrict_finalized_update
  BEFORE UPDATE ON sales_invoices
  FOR EACH ROW EXECUTE FUNCTION restrict_finalized_sales_invoice_update();
--> statement-breakpoint
CREATE TRIGGER settlements_restrict_finalized_update
  BEFORE UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION restrict_finalized_settlement_update();
