-- BE-033 — تراز دفترکل در لایه‌ی PostgreSQL، نه service.
--
-- این trigger عمداً CONSTRAINT TRIGGER و DEFERRABLE INITIALLY DEFERRED است:
-- یک posting می‌تواند entryهای خود را پشت‌سرهم بسازد و فقط در COMMIT بررسی شود.
-- هر بُعد مستقل است؛ مجموع ردیف‌های طلا هرگز با ریال یا تعداد سکه خنثی نمی‌شود.
CREATE OR REPLACE FUNCTION enforce_ledger_transaction_balance() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  primary_tenant_id uuid;
  primary_transaction_id uuid;
  secondary_tenant_id uuid;
  secondary_transaction_id uuid;
  candidate record;
  violating_dimension_id uuid;
  violating_quantity numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    primary_tenant_id := OLD.tenant_id;
    primary_transaction_id := OLD.transaction_id;
  ELSE
    primary_tenant_id := NEW.tenant_id;
    primary_transaction_id := NEW.transaction_id;
  END IF;

  -- UPDATE در نقش runtime ممنوع است، اما constraint باید حتی SQL مهاجرتی را هم
  -- درست نگه دارد: اگر entry به transaction دیگری منتقل شود، هر دو طرف بررسی شوند.
  IF TG_OP = 'UPDATE'
     AND (OLD.tenant_id, OLD.transaction_id) IS DISTINCT FROM (NEW.tenant_id, NEW.transaction_id) THEN
    secondary_tenant_id := OLD.tenant_id;
    secondary_transaction_id := OLD.transaction_id;
  END IF;

  FOR candidate IN
    SELECT primary_tenant_id AS tenant_id, primary_transaction_id AS transaction_id
    UNION
    SELECT secondary_tenant_id, secondary_transaction_id
    WHERE secondary_transaction_id IS NOT NULL
  LOOP
    SELECT "dimension_id", SUM("quantity")
    INTO violating_dimension_id, violating_quantity
    FROM "ledger_entries"
    WHERE "tenant_id" = candidate.tenant_id
      AND "transaction_id" = candidate.transaction_id
    GROUP BY "dimension_id"
    HAVING SUM("quantity") <> 0
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION
        'ledger transaction % is not balanced in dimension %',
        candidate.transaction_id,
        violating_dimension_id
        USING ERRCODE = '23514',
          DETAIL = format(
            'tenant_id=%s, dimension_id=%s, total_quantity=%s',
            candidate.tenant_id,
            violating_dimension_id,
            violating_quantity
          );
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER ledger_entries_balance_per_dimension
  AFTER INSERT OR UPDATE OR DELETE ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_ledger_transaction_balance();
