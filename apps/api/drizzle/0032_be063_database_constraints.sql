ALTER TABLE "second_hand_purchase_items" DROP CONSTRAINT "second_hand_purchase_items_gold_fields_check";--> statement-breakpoint
ALTER TABLE "second_hand_purchase_items" DROP CONSTRAINT "second_hand_purchase_items_coin_fields_check";--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "jewelry_item_id" uuid GENERATED ALWAYS AS (CASE WHEN "item_type" = 'JEWELRY' THEN "item_id" END) STORED;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "coin_type_id" uuid GENERATED ALWAYS AS (CASE WHEN "item_type" = 'COIN' THEN "item_id" END) STORED;--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ADD COLUMN "jewelry_item_id" uuid GENERATED ALWAYS AS (CASE WHEN "item_type" = 'JEWELRY' THEN "item_id" END) STORED;--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ADD COLUMN "coin_type_id" uuid GENERATED ALWAYS AS (CASE WHEN "item_type" = 'COIN' THEN "item_id" END) STORED;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_jewelry_item_fk" FOREIGN KEY ("tenant_id","jewelry_item_id") REFERENCES "public"."jewelry_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_coin_type_fk" FOREIGN KEY ("tenant_id","coin_type_id") REFERENCES "public"."coin_types"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_tenant_jewelry_item_fk" FOREIGN KEY ("tenant_id","jewelry_item_id") REFERENCES "public"."jewelry_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_tenant_coin_type_fk" FOREIGN KEY ("tenant_id","coin_type_id") REFERENCES "public"."coin_types"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_number_positive_check" CHECK ("sales_invoices"."invoice_number" IS NULL OR "sales_invoices"."invoice_number" > 0);--> statement-breakpoint
ALTER TABLE "second_hand_purchase_items" ADD CONSTRAINT "second_hand_purchase_items_gold_fields_check" CHECK (
        "second_hand_purchase_items"."item_type" <> 'GOLD' OR (
          "second_hand_purchase_items"."gross_weight_mg" IS NOT NULL AND
          "second_hand_purchase_items"."stone_weight_mg" IS NOT NULL AND
          "second_hand_purchase_items"."other_deduction_weight_mg" IS NOT NULL AND
          "second_hand_purchase_items"."purchase_karat" IS NOT NULL AND
          "second_hand_purchase_items"."pure_weight_mg" IS NOT NULL AND
          "second_hand_purchase_items"."gross_weight_mg" > 0 AND
          "second_hand_purchase_items"."stone_weight_mg" >= 0 AND
          "second_hand_purchase_items"."other_deduction_weight_mg" >= 0 AND
          "second_hand_purchase_items"."gross_weight_mg" >= "second_hand_purchase_items"."stone_weight_mg" + "second_hand_purchase_items"."other_deduction_weight_mg" AND
          "second_hand_purchase_items"."purchase_karat" BETWEEN 1 AND 1000 AND
          "second_hand_purchase_items"."pure_weight_mg" > 0 AND
          "second_hand_purchase_items"."coin_type_id" IS NULL AND
          "second_hand_purchase_items"."coin_count" IS NULL
        )
      );--> statement-breakpoint
ALTER TABLE "second_hand_purchase_items" ADD CONSTRAINT "second_hand_purchase_items_coin_fields_check" CHECK (
        "second_hand_purchase_items"."item_type" <> 'COIN' OR (
          "second_hand_purchase_items"."gross_weight_mg" IS NULL AND
          "second_hand_purchase_items"."stone_weight_mg" IS NULL AND
          "second_hand_purchase_items"."other_deduction_weight_mg" IS NULL AND
          "second_hand_purchase_items"."purchase_karat" IS NULL AND
          "second_hand_purchase_items"."pure_weight_mg" IS NULL AND
          "second_hand_purchase_items"."coin_type_id" IS NOT NULL AND
          "second_hand_purchase_items"."coin_count" IS NOT NULL AND
          "second_hand_purchase_items"."coin_count" > 0
        )
      );--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_locked_quote_complete_check" CHECK (("settlement_lines"."locked_quote_id" IS NULL) = ("settlement_lines"."locked_quote_amount_rial" IS NULL));--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_locked_quote_amount_positive_check" CHECK ("settlement_lines"."locked_quote_amount_rial" IS NULL OR "settlement_lines"."locked_quote_amount_rial" > 0);
--> statement-breakpoint

-- ===========================================================================
-- BE-063 — محدودیت‌های دیتابیس: آنچه drizzle-kit از schema نمی‌سازد.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- ۱. Append-Only مستقل از نقش
--
-- تریگرهای قبلی فقط وقتی جلوی UPDATE/DELETE را می‌گرفتند که
-- `current_user = 'gold_app'` بود؛ نقش مهاجرت (و هر اتصال مستقیم دیگری)
-- می‌توانست تاریخچه‌ی مالی را بی‌صدا بازنویسی کند. از این مهاجرت به بعد
-- مسیر عادی SQL برای هیچ نقشی باز نیست. فقط دو اثرِ کلید خارجی مجازند،
-- و هر دو فقط وقتی که از داخل یک action کلید خارجی رسیده‌اند
-- (`pg_trigger_depth() > 1`)، نه از یک دستور مستقیم:
--
--   * پاک‌سازی کامل مستأجر — ردیف مستأجر دیگر وجود ندارد و cascade
--     همه‌ی داده‌اش را می‌برد. بدون این، حذف مستأجرِ کوتاه‌عمر تست هم
--     ممکن نبود.
--   * `ON DELETE SET NULL` ستون کاربر سازنده (ستون در `TG_ARGV[0]`)، وقتی
--     هیچ ستون دیگری عوض نمی‌شود — حذف کاربر سند را عوض نمی‌کند، فقط
--     ارجاع به او را.
--
-- اصلاح اضطراری واقعی هنوز ممکن است، ولی فقط با `ALTER TABLE ... DISABLE
-- TRIGGER` صریح — تصمیمی که در خود SQL دیده می‌شود، نه یک UPDATE بی‌صدا.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_tenant_purge_cascade(target_tenant_id uuid) RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  -- SECURITY DEFINER: نقش برنامه نباید با محدودیت دیدش روی `tenants` بتواند
  -- مستأجر موجود را «حذف‌شده» جا بزند.
  SELECT pg_trigger_depth() > 1
    AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = target_tenant_id);
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_append_only() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  nullable_user_column text := TG_ARGV[0];
BEGIN
  IF is_tenant_purge_cascade(OLD.tenant_id) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND nullable_user_column IS NOT NULL
     AND pg_trigger_depth() > 1
     AND to_jsonb(NEW) -> nullable_user_column = 'null'::jsonb
     AND to_jsonb(NEW) - nullable_user_column = to_jsonb(OLD) - nullable_user_column THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000',
      HINT = 'اصلاح یعنی سند تازه، نه بازنویسی ردیف قبلی.';
END;
$$;
--> statement-breakpoint

DROP TRIGGER ledger_transactions_prevent_mutation ON ledger_transactions;--> statement-breakpoint
CREATE TRIGGER ledger_transactions_prevent_mutation
  BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only('created_by');--> statement-breakpoint

DROP TRIGGER ledger_entries_prevent_mutation ON ledger_entries;--> statement-breakpoint
CREATE TRIGGER ledger_entries_prevent_mutation
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();--> statement-breakpoint

DROP TRIGGER inventory_movements_prevent_mutation ON inventory_movements;--> statement-breakpoint
CREATE TRIGGER inventory_movements_prevent_mutation
  BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();--> statement-breakpoint

DROP TRIGGER audit_logs_prevent_mutation ON audit_logs;--> statement-breakpoint
CREATE TRIGGER audit_logs_prevent_mutation
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only('actor_user_id');--> statement-breakpoint

DROP TRIGGER price_quotes_prevent_mutation ON price_quotes;--> statement-breakpoint
CREATE TRIGGER price_quotes_prevent_mutation
  BEFORE UPDATE OR DELETE ON price_quotes
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only('created_by');--> statement-breakpoint

DROP TRIGGER opening_balances_prevent_mutation ON opening_balances;--> statement-breakpoint
CREATE TRIGGER opening_balances_prevent_mutation
  BEFORE UPDATE OR DELETE ON opening_balances
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only('created_by');--> statement-breakpoint

DROP TRIGGER sales_invoice_versions_prevent_mutation ON sales_invoice_versions;--> statement-breakpoint
CREATE TRIGGER sales_invoice_versions_prevent_mutation
  BEFORE UPDATE OR DELETE ON sales_invoice_versions
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only('created_by');--> statement-breakpoint

DROP TRIGGER sales_invoice_items_prevent_mutation ON sales_invoice_items;--> statement-breakpoint
CREATE TRIGGER sales_invoice_items_prevent_mutation
  BEFORE UPDATE OR DELETE ON sales_invoice_items
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();--> statement-breakpoint

DROP TRIGGER settlement_lines_prevent_mutation ON settlement_lines;--> statement-breakpoint
CREATE TRIGGER settlement_lines_prevent_mutation
  BEFORE UPDATE OR DELETE ON settlement_lines
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();--> statement-breakpoint

DROP TRIGGER second_hand_purchases_prevent_mutation ON second_hand_purchases;--> statement-breakpoint
CREATE TRIGGER second_hand_purchases_prevent_mutation
  BEFORE UPDATE OR DELETE ON second_hand_purchases
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only('created_by');--> statement-breakpoint

DROP TRIGGER second_hand_purchase_items_prevent_mutation ON second_hand_purchase_items;--> statement-breakpoint
CREATE TRIGGER second_hand_purchase_items_prevent_mutation
  BEFORE UPDATE OR DELETE ON second_hand_purchase_items
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();--> statement-breakpoint

DROP FUNCTION prevent_ledger_transaction_mutation();--> statement-breakpoint
DROP FUNCTION prevent_ledger_entry_mutation();--> statement-breakpoint
DROP FUNCTION prevent_inventory_movement_mutation();--> statement-breakpoint
DROP FUNCTION prevent_audit_log_mutation();--> statement-breakpoint
DROP FUNCTION prevent_price_quote_mutation();--> statement-breakpoint
DROP FUNCTION prevent_opening_balance_mutation();--> statement-breakpoint
DROP FUNCTION prevent_sales_invoice_version_mutation();--> statement-breakpoint
DROP FUNCTION prevent_sales_invoice_item_mutation();--> statement-breakpoint
DROP FUNCTION prevent_settlement_line_mutation();--> statement-breakpoint
DROP FUNCTION prevent_second_hand_purchase_mutation();--> statement-breakpoint
DROP FUNCTION prevent_second_hand_purchase_item_mutation();--> statement-breakpoint

-- شماره‌ی فاکتورِ صادرشده هم برای هر نقشی قفل است، نه فقط gold_app.
CREATE OR REPLACE FUNCTION prevent_sales_invoice_number_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.invoice_number IS NOT NULL
     AND NEW.invoice_number IS DISTINCT FROM OLD.invoice_number THEN
    RAISE EXCEPTION 'sales invoice number is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ۲. نسخه‌های تنظیمات و مشخصات: نه حذف، نه هم‌پوشانی
--
-- نسخه‌ی تاریخی همان چیزی است که فاکتور دو ماه پیش را بازتولید می‌کند
-- (قاعده‌ی ۲-۶). حذفش با SQL مستقیم دیگر ممکن نیست؛ فقط پاک‌سازی مستأجر.
-- ---------------------------------------------------------------------------
CREATE TRIGGER versioned_settings_prevent_delete
  BEFORE DELETE ON versioned_settings
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();--> statement-breakpoint
CREATE TRIGGER coin_type_versions_prevent_delete
  BEFORE DELETE ON coin_type_versions
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();--> statement-breakpoint
CREATE TRIGGER jewelry_item_versions_prevent_delete
  BEFORE DELETE ON jewelry_item_versions
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only();--> statement-breakpoint

-- `versioned_settings` و `coin_type_versions` این را از مهاجرت‌های ۰۰۰۹ و
-- ۰۰۱۰ دارند؛ نسخه‌های زیورآلات تنها جدول نسخه‌دار بدون آن بودند.
ALTER TABLE "jewelry_item_versions"
  ADD CONSTRAINT "jewelry_item_versions_no_overlapping_validity"
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    "jewelry_item_id" WITH =,
    tstzrange("valid_from", "valid_to", '[)') WITH &&
  );--> statement-breakpoint

-- نسخه‌ی بسته کاملاً ثابت است. روی نسخه‌ی باز فقط همان سه کاری که
-- `JewelryItemsService` می‌کند مجاز است: بستن بازه، تغییر عنوان (با کلید
-- جست‌وجویش) و غیرفعال‌سازی. هر مشخصه‌ی قیمت‌ساز فقط با نسخه‌ی تازه عوض
-- می‌شود.
CREATE OR REPLACE FUNCTION restrict_jewelry_item_version_update() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.valid_to IS NOT NULL
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.jewelry_item_id IS DISTINCT FROM OLD.jewelry_item_id
    OR NEW.gross_weight_mg IS DISTINCT FROM OLD.gross_weight_mg
    OR NEW.karat IS DISTINCT FROM OLD.karat
    OR NEW.stone_weight_mg IS DISTINCT FROM OLD.stone_weight_mg
    OR NEW.other_deduction_weight_mg IS DISTINCT FROM OLD.other_deduction_weight_mg
    OR NEW.wage_type IS DISTINCT FROM OLD.wage_type
    OR NEW.wage_value IS DISTINCT FROM OLD.wage_value
    OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'jewelry item version records are immutable except for title, active and closing an open interval'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER jewelry_item_versions_restrict_update
  BEFORE UPDATE ON "jewelry_item_versions"
  FOR EACH ROW EXECUTE FUNCTION restrict_jewelry_item_version_update();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ۳. همخوانی نوع با بُعد (قاعده‌ی ۲-۲)
--
-- کلید خارجی فقط می‌گوید بُعد وجود دارد، نه اینکه بُعدِ درست است. بدون
-- این دو تریگر، حرکت سکه می‌توانست روی بُعد طلا بنشیند — یعنی همان
-- «سکه به‌صورت گرم» که موقعیت حبابی کاربر را گم می‌کند. هویت بُعد بعد از
-- ساخت تغییرناپذیر است (مهاجرت ۰۰۱۶)، پس بررسی در لحظه‌ی درج کافی است.
-- SECURITY DEFINER تا نتیجه به RLS وابسته نباشد.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_inventory_movement_dimension() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  dimension_kind asset_dimension_kind;
  dimension_coin_type_id uuid;
BEGIN
  SELECT kind, coin_type_id INTO dimension_kind, dimension_coin_type_id
  FROM asset_dimensions
  WHERE tenant_id = NEW.tenant_id AND id = NEW.dimension_id;

  -- بُعد ناموجود را کلید خارجی با پیام خودش رد می‌کند.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.item_type = 'COIN' THEN
    IF dimension_kind IS DISTINCT FROM 'COIN' OR dimension_coin_type_id IS DISTINCT FROM NEW.item_id THEN
      RAISE EXCEPTION 'coin inventory movement must use the dimension of the same coin type'
        USING ERRCODE = '23514', CONSTRAINT = 'inventory_movements_dimension_matches_item_check';
    END IF;
  ELSIF dimension_kind IS DISTINCT FROM 'GOLD' THEN
    RAISE EXCEPTION '% inventory movement must use the gold dimension', NEW.item_type
      USING ERRCODE = '23514', CONSTRAINT = 'inventory_movements_dimension_matches_item_check';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER inventory_movements_dimension_matches_item
  BEFORE INSERT ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION enforce_inventory_movement_dimension();--> statement-breakpoint

-- `CREDIT` جابه‌جایی طلب ریالی بین حساب‌های خود شخص است، پس روی بُعد ریال.
CREATE OR REPLACE FUNCTION enforce_settlement_line_dimension() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  dimension_kind asset_dimension_kind;
BEGIN
  SELECT kind INTO dimension_kind
  FROM asset_dimensions
  WHERE tenant_id = NEW.tenant_id AND id = NEW.dimension_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF dimension_kind IS DISTINCT FROM (
    CASE NEW.line_type
      WHEN 'RIAL' THEN 'RIAL'
      WHEN 'CREDIT' THEN 'RIAL'
      WHEN 'GOLD' THEN 'GOLD'
      WHEN 'COIN' THEN 'COIN'
    END
  )::asset_dimension_kind THEN
    RAISE EXCEPTION '% settlement line cannot use a % dimension', NEW.line_type, dimension_kind
      USING ERRCODE = '23514', CONSTRAINT = 'settlement_lines_dimension_matches_type_check';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER settlement_lines_dimension_matches_type
  BEFORE INSERT ON settlement_lines
  FOR EACH ROW EXECUTE FUNCTION enforce_settlement_line_dimension();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- ۴. کلیدهای خارجی کالا: بررسی در COMMIT
--
-- حذف مستأجر کالا و ردیف‌های فاکتور را از دو شاخه‌ی cascade جدا می‌برد
-- (`tenants → jewelry_items` و `tenants → sales_invoices → sales_invoice_items`)
-- و ترتیب این دو تضمین‌شده نیست. NO ACTION عادی در پایان همان شاخه بررسی
-- می‌شود و پاک‌سازی مستأجر را می‌شکست؛ deferred تا COMMIT صبر می‌کند. حذف
-- کالایی که تاریخچه دارد همچنان رد می‌شود — فقط خطا در COMMIT می‌رسد.
-- drizzle-kit سازنده‌ی DEFERRABLE ندارد، پس اینجا تنظیم می‌شود.
-- ---------------------------------------------------------------------------
ALTER TABLE "inventory_movements" ALTER CONSTRAINT "inventory_movements_tenant_jewelry_item_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "inventory_movements" ALTER CONSTRAINT "inventory_movements_tenant_coin_type_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ALTER CONSTRAINT "sales_invoice_items_tenant_jewelry_item_fk" DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ALTER CONSTRAINT "sales_invoice_items_tenant_coin_type_fk" DEFERRABLE INITIALLY DEFERRED;
