CREATE TYPE "public"."price_quote_source" AS ENUM('MANUAL', 'FEED');--> statement-breakpoint
CREATE TYPE "public"."price_quote_type" AS ENUM('MAZNEH');--> statement-breakpoint
CREATE TABLE "price_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_type" "price_quote_type" NOT NULL,
	"amount_rial" bigint NOT NULL,
	"source" "price_quote_source" NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_quotes_amount_positive_check" CHECK ("price_quotes"."amount_rial" > 0)
);
--> statement-breakpoint
ALTER TABLE "price_quotes" ADD CONSTRAINT "price_quotes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_quotes" ADD CONSTRAINT "price_quotes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_quotes_latest_lookup_idx" ON "price_quotes" USING btree ("tenant_id","quote_type","observed_at","created_at");--> statement-breakpoint
SELECT enable_tenant_rls('price_quotes');--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_price_quote_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  -- A quote is financial evidence. Runtime may append a corrected observation,
  -- but it may never rewrite or remove the original observed value.
  IF current_user = 'gold_app' THEN
    RAISE EXCEPTION 'price_quotes are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER price_quotes_prevent_mutation
  BEFORE UPDATE OR DELETE ON price_quotes
  FOR EACH ROW EXECUTE FUNCTION prevent_price_quote_mutation();
