CREATE TYPE "public"."settlement_line_type" AS ENUM('RIAL', 'GOLD', 'COIN', 'CREDIT');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('DRAFT', 'FINALIZED');--> statement-breakpoint
CREATE TABLE "settlement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"line_type" "settlement_line_type" NOT NULL,
	"dimension_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"source_account_id" uuid NOT NULL,
	"destination_account_id" uuid NOT NULL,
	"locked_quote_id" uuid,
	"locked_quote_amount_rial" bigint,
	"locked_conversion_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_lines_quantity_positive_check" CHECK ("settlement_lines"."quantity" > 0),
	CONSTRAINT "settlement_lines_accounts_distinct_check" CHECK ("settlement_lines"."source_account_id" <> "settlement_lines"."destination_account_id")
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"status" "settlement_status" DEFAULT 'DRAFT' NOT NULL,
	"effective_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "settlements_finalized_fields_check" CHECK (("settlements"."status" = 'DRAFT') OR ("settlements"."effective_at" IS NOT NULL AND "settlements"."finalized_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_tenant_settlement_fk" FOREIGN KEY ("tenant_id","settlement_id") REFERENCES "public"."settlements"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_tenant_dimension_fk" FOREIGN KEY ("tenant_id","dimension_id") REFERENCES "public"."asset_dimensions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_tenant_source_account_fk" FOREIGN KEY ("tenant_id","source_account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_tenant_destination_account_fk" FOREIGN KEY ("tenant_id","destination_account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_tenant_quote_fk" FOREIGN KEY ("tenant_id","locked_quote_id") REFERENCES "public"."price_quotes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_tenant_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settlement_lines_tenant_settlement_idx" ON "settlement_lines" USING btree ("tenant_id","settlement_id");--> statement-breakpoint
CREATE INDEX "settlements_tenant_party_idx" ON "settlements" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE INDEX "settlements_tenant_status_idx" ON "settlements" USING btree ("tenant_id","status");--> statement-breakpoint
SELECT enable_tenant_rls('settlements');--> statement-breakpoint
SELECT enable_tenant_rls('settlement_lines');--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_settlement_line_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  -- BE-044: ردیف‌های تسویه Append-Only هستند. اصلاح یعنی تسویه‌ی جدید،
  -- نه بازنویسی ردیف قبلی — همان الگوی inventory_movements در migration 0015.
  IF current_user = 'gold_app' THEN
    RAISE EXCEPTION 'settlement_lines are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER settlement_lines_prevent_mutation
  BEFORE UPDATE OR DELETE ON settlement_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_settlement_line_mutation();