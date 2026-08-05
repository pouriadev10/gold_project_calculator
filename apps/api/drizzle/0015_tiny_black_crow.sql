CREATE TYPE "public"."inventory_item_type" AS ENUM('JEWELRY', 'MELTED_GOLD', 'COIN');--> statement-breakpoint
CREATE TYPE "public"."inventory_movement_source_type" AS ENUM('OPENING_BALANCE', 'SALE', 'PURCHASE', 'CORRECTION');--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_type" "inventory_movement_source_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"item_type" "inventory_item_type" NOT NULL,
	"item_id" uuid,
	"dimension_id" uuid,
	"quantity" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_quantity_nonzero_check" CHECK ("inventory_movements"."quantity" <> 0),
	CONSTRAINT "inventory_movements_item_identity_check" CHECK (("inventory_movements"."item_type" = 'MELTED_GOLD') = ("inventory_movements"."item_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movements_balance_idx" ON "inventory_movements" USING btree ("tenant_id","item_type","item_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_source_idx" ON "inventory_movements" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_occurred_at_idx" ON "inventory_movements" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
SELECT enable_tenant_rls('inventory_movements');--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_inventory_movement_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  -- BE-027: دفتر حرکات موجودی Append-Only است. اصلاح موجودی یعنی یک
  -- حرکت جدید با علامت مخالف و `source_type = 'CORRECTION'`، نه بازنویسی
  -- ردیف قبلی. نقش برنامه حتی با SQL مستقیم هم نباید بتواند تاریخ را
  -- عوض کند؛ همان الگوی `price_quotes` در مهاجرت ۰۰۱۱.
  IF current_user = 'gold_app' THEN
    RAISE EXCEPTION 'inventory_movements are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER inventory_movements_prevent_mutation
  BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION prevent_inventory_movement_mutation();
