CREATE TYPE "public"."ledger_transaction_source_type" AS ENUM('OPENING_BALANCE', 'SALES_INVOICE', 'SECOND_HAND_PURCHASE', 'SETTLEMENT', 'SALES_INVOICE_AMENDMENT');--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"dimension_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_quantity_nonzero_check" CHECK ("ledger_entries"."quantity" <> 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_type" "ledger_transaction_source_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"reversal_of_transaction_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transactions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "ledger_transactions_description_nonblank_check" CHECK (length(btrim("ledger_transactions"."description")) > 0),
	CONSTRAINT "ledger_transactions_not_self_reversal_check" CHECK ("ledger_transactions"."reversal_of_transaction_id" IS NULL OR "ledger_transactions"."reversal_of_transaction_id" <> "ledger_transactions"."id")
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_transaction_fk" FOREIGN KEY ("tenant_id","transaction_id") REFERENCES "public"."ledger_transactions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_dimension_fk" FOREIGN KEY ("tenant_id","dimension_id") REFERENCES "public"."asset_dimensions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_tenant_reversal_fk" FOREIGN KEY ("tenant_id","reversal_of_transaction_id") REFERENCES "public"."ledger_transactions"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_tenant_transaction_idx" ON "ledger_entries" USING btree ("tenant_id","transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_tenant_account_dimension_idx" ON "ledger_entries" USING btree ("tenant_id","account_id","dimension_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_tenant_dimension_idx" ON "ledger_entries" USING btree ("tenant_id","dimension_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transactions_tenant_source_unique" ON "ledger_transactions" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "ledger_transactions_tenant_effective_at_idx" ON "ledger_transactions" USING btree ("tenant_id","effective_at");--> statement-breakpoint
CREATE INDEX "ledger_transactions_tenant_reversal_idx" ON "ledger_transactions" USING btree ("tenant_id","reversal_of_transaction_id");--> statement-breakpoint

-- BE-032 — هر دو جدول داده‌ی tenant-scoped هستند؛ بدون RLS، یک query خام می‌تواند
-- history مالی tenant دیگر را ببیند یا بسازد.
SELECT enable_tenant_rls('ledger_transactions');--> statement-breakpoint
SELECT enable_tenant_rls('ledger_entries');--> statement-breakpoint

-- سربرگ و ردیف‌های دفترکل فقط با ایجاد سند اصلاحی تغییر می‌کنند. نقش runtime
-- حتی با SQL مستقیم هم نمی‌تواند source، زمان مؤثر، حساب یا مقدار تاریخچه را بازنویسی کند.
CREATE OR REPLACE FUNCTION prevent_ledger_transaction_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'gold_app' THEN
    RAISE EXCEPTION 'ledger_transactions are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER ledger_transactions_prevent_mutation
  BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_transaction_mutation();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_ledger_entry_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'gold_app' THEN
    RAISE EXCEPTION 'ledger_entries are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER ledger_entries_prevent_mutation
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_mutation();
