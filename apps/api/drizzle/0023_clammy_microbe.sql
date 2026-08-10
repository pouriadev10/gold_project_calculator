CREATE TYPE "public"."sales_invoice_item_type" AS ENUM('JEWELRY', 'COIN');--> statement-breakpoint
CREATE TYPE "public"."sales_invoice_status" AS ENUM('DRAFT', 'FINALIZED');--> statement-breakpoint
CREATE TABLE "sales_invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sales_invoice_id" uuid NOT NULL,
	"sales_invoice_version_id" uuid NOT NULL,
	"item_type" "sales_invoice_item_type" NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"line_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_invoice_items_quantity_positive_check" CHECK ("sales_invoice_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales_invoice_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sales_invoice_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"reason" text,
	"totals_snapshot" jsonb NOT NULL,
	"settings_snapshot" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_invoice_versions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "sales_invoice_versions_tenant_invoice_id_id_unique" UNIQUE("tenant_id","sales_invoice_id","id"),
	CONSTRAINT "sales_invoice_versions_version_positive_check" CHECK ("sales_invoice_versions"."version" >= 1),
	CONSTRAINT "sales_invoice_versions_reason_on_amendment_check" CHECK ("sales_invoice_versions"."version" = 1 OR "sales_invoice_versions"."reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "sales_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_number" integer,
	"current_version" integer DEFAULT 0 NOT NULL,
	"status" "sales_invoice_status" DEFAULT 'DRAFT' NOT NULL,
	"party_id" uuid NOT NULL,
	"quote_id" uuid,
	"quote_amount_rial" bigint,
	"quote_observed_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_invoices_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "sales_invoices_current_version_nonnegative_check" CHECK ("sales_invoices"."current_version" >= 0),
	CONSTRAINT "sales_invoices_number_when_finalized_check" CHECK (("sales_invoices"."status" = 'FINALIZED') = ("sales_invoices"."invoice_number" IS NOT NULL)),
	CONSTRAINT "sales_invoices_quote_when_finalized_check" CHECK ("sales_invoices"."status" = 'DRAFT' OR (
        "sales_invoices"."quote_id" IS NOT NULL AND
        "sales_invoices"."quote_amount_rial" IS NOT NULL AND
        "sales_invoices"."quote_observed_at" IS NOT NULL AND
        "sales_invoices"."finalized_at" IS NOT NULL
      )),
	CONSTRAINT "sales_invoices_version_matches_status_check" CHECK (("sales_invoices"."status" = 'DRAFT' AND "sales_invoices"."current_version" = 0) OR ("sales_invoices"."status" = 'FINALIZED' AND "sales_invoices"."current_version" >= 1)),
	CONSTRAINT "sales_invoices_quote_amount_positive_check" CHECK ("sales_invoices"."quote_amount_rial" IS NULL OR "sales_invoices"."quote_amount_rial" > 0)
);
--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_tenant_invoice_fk" FOREIGN KEY ("tenant_id","sales_invoice_id") REFERENCES "public"."sales_invoices"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_tenant_invoice_version_fk" FOREIGN KEY ("tenant_id","sales_invoice_id","sales_invoice_version_id") REFERENCES "public"."sales_invoice_versions"("tenant_id","sales_invoice_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_versions" ADD CONSTRAINT "sales_invoice_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_versions" ADD CONSTRAINT "sales_invoice_versions_tenant_invoice_fk" FOREIGN KEY ("tenant_id","sales_invoice_id") REFERENCES "public"."sales_invoices"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_quotes" ADD CONSTRAINT "price_quotes_tenant_id_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_tenant_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_tenant_quote_fk" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "public"."price_quotes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_invoice_items_tenant_version_idx" ON "sales_invoice_items" USING btree ("tenant_id","sales_invoice_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoice_versions_tenant_invoice_version_unique" ON "sales_invoice_versions" USING btree ("tenant_id","sales_invoice_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_tenant_number_unique" ON "sales_invoices" USING btree ("tenant_id","invoice_number");--> statement-breakpoint
CREATE INDEX "sales_invoices_tenant_party_idx" ON "sales_invoices" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE INDEX "sales_invoices_tenant_status_idx" ON "sales_invoices" USING btree ("tenant_id","status");--> statement-breakpoint
--> statement-breakpoint
SELECT enable_tenant_rls('sales_invoices');
--> statement-breakpoint
SELECT enable_tenant_rls('sales_invoice_versions');
--> statement-breakpoint
SELECT enable_tenant_rls('sales_invoice_items');
--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_sales_invoice_number_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'gold_app'
     AND OLD.invoice_number IS NOT NULL
     AND NEW.invoice_number IS DISTINCT FROM OLD.invoice_number THEN
    RAISE EXCEPTION 'sales invoice number is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sales_invoices_prevent_number_mutation
  BEFORE UPDATE ON sales_invoices
  FOR EACH ROW EXECUTE FUNCTION prevent_sales_invoice_number_mutation();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_sales_invoice_version_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'gold_app' THEN
    RAISE EXCEPTION 'sales invoice versions are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sales_invoice_versions_prevent_mutation
  BEFORE UPDATE OR DELETE ON sales_invoice_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_sales_invoice_version_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_sales_invoice_item_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'gold_app' THEN
    RAISE EXCEPTION 'sales invoice items are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sales_invoice_items_prevent_mutation
  BEFORE UPDATE OR DELETE ON sales_invoice_items
  FOR EACH ROW EXECUTE FUNCTION prevent_sales_invoice_item_mutation();
