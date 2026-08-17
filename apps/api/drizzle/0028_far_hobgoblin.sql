CREATE TYPE "public"."second_hand_purchase_destination_inventory_type" AS ENUM('MELTED_GOLD', 'COIN');--> statement-breakpoint
CREATE TYPE "public"."second_hand_purchase_item_type" AS ENUM('GOLD', 'COIN');--> statement-breakpoint
CREATE TABLE "second_hand_purchase_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"second_hand_purchase_id" uuid NOT NULL,
	"item_type" "second_hand_purchase_item_type" NOT NULL,
	"destination_inventory_type" "second_hand_purchase_destination_inventory_type" DEFAULT 'MELTED_GOLD' NOT NULL,
	"gross_weight_mg" bigint,
	"stone_weight_mg" bigint,
	"other_deduction_weight_mg" bigint,
	"purchase_karat" integer,
	"pure_weight_mg" bigint,
	"coin_type_id" uuid,
	"coin_count" integer,
	"item_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "second_hand_purchase_items_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "second_hand_purchase_items_destination_matches_type_check" CHECK (("second_hand_purchase_items"."item_type" = 'GOLD') = ("second_hand_purchase_items"."destination_inventory_type" = 'MELTED_GOLD')),
	CONSTRAINT "second_hand_purchase_items_gold_fields_check" CHECK (
        "second_hand_purchase_items"."item_type" <> 'GOLD' OR (
          "second_hand_purchase_items"."gross_weight_mg" > 0 AND
          "second_hand_purchase_items"."stone_weight_mg" >= 0 AND
          "second_hand_purchase_items"."other_deduction_weight_mg" >= 0 AND
          "second_hand_purchase_items"."gross_weight_mg" >= "second_hand_purchase_items"."stone_weight_mg" + "second_hand_purchase_items"."other_deduction_weight_mg" AND
          "second_hand_purchase_items"."purchase_karat" BETWEEN 1 AND 1000 AND
          "second_hand_purchase_items"."pure_weight_mg" > 0 AND
          "second_hand_purchase_items"."coin_type_id" IS NULL AND
          "second_hand_purchase_items"."coin_count" IS NULL
        )
      ),
	CONSTRAINT "second_hand_purchase_items_coin_fields_check" CHECK (
        "second_hand_purchase_items"."item_type" <> 'COIN' OR (
          "second_hand_purchase_items"."gross_weight_mg" IS NULL AND
          "second_hand_purchase_items"."stone_weight_mg" IS NULL AND
          "second_hand_purchase_items"."other_deduction_weight_mg" IS NULL AND
          "second_hand_purchase_items"."purchase_karat" IS NULL AND
          "second_hand_purchase_items"."pure_weight_mg" IS NULL AND
          "second_hand_purchase_items"."coin_type_id" IS NOT NULL AND
          "second_hand_purchase_items"."coin_count" > 0
        )
      )
);
--> statement-breakpoint
CREATE TABLE "second_hand_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"source_invoice_id" uuid,
	"locked_quote_id" uuid NOT NULL,
	"locked_quote_amount_rial" bigint NOT NULL,
	"locked_quote_observed_at" timestamp with time zone NOT NULL,
	"settings_snapshot" jsonb NOT NULL,
	"seller_identity_snapshot" jsonb NOT NULL,
	"fee_rial" bigint NOT NULL,
	"final_amount_rial" bigint NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "second_hand_purchases_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "second_hand_purchases_locked_quote_amount_positive_check" CHECK ("second_hand_purchases"."locked_quote_amount_rial" > 0),
	CONSTRAINT "second_hand_purchases_fee_nonnegative_check" CHECK ("second_hand_purchases"."fee_rial" >= 0),
	CONSTRAINT "second_hand_purchases_final_amount_positive_check" CHECK ("second_hand_purchases"."final_amount_rial" > 0)
);
--> statement-breakpoint
ALTER TABLE "second_hand_purchase_items" ADD CONSTRAINT "second_hand_purchase_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "second_hand_purchase_items" ADD CONSTRAINT "second_hand_purchase_items_tenant_purchase_fk" FOREIGN KEY ("tenant_id","second_hand_purchase_id") REFERENCES "public"."second_hand_purchases"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "second_hand_purchase_items" ADD CONSTRAINT "second_hand_purchase_items_tenant_coin_type_fk" FOREIGN KEY ("tenant_id","coin_type_id") REFERENCES "public"."coin_types"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "second_hand_purchases" ADD CONSTRAINT "second_hand_purchases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "second_hand_purchases" ADD CONSTRAINT "second_hand_purchases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "second_hand_purchases" ADD CONSTRAINT "second_hand_purchases_tenant_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "second_hand_purchases" ADD CONSTRAINT "second_hand_purchases_tenant_source_invoice_fk" FOREIGN KEY ("tenant_id","source_invoice_id") REFERENCES "public"."sales_invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "second_hand_purchases" ADD CONSTRAINT "second_hand_purchases_tenant_quote_fk" FOREIGN KEY ("tenant_id","locked_quote_id") REFERENCES "public"."price_quotes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "second_hand_purchase_items_tenant_purchase_idx" ON "second_hand_purchase_items" USING btree ("tenant_id","second_hand_purchase_id");--> statement-breakpoint
CREATE INDEX "second_hand_purchases_tenant_party_effective_at_idx" ON "second_hand_purchases" USING btree ("tenant_id","party_id","effective_at");--> statement-breakpoint
CREATE INDEX "second_hand_purchases_tenant_source_invoice_idx" ON "second_hand_purchases" USING btree ("tenant_id","source_invoice_id");--> statement-breakpoint
SELECT enable_tenant_rls('second_hand_purchases');--> statement-breakpoint
SELECT enable_tenant_rls('second_hand_purchase_items');--> statement-breakpoint

-- BE-049: a completed purchase is historical evidence. It is corrected by a
-- later source document and ledger posting, never by rewriting the original.
CREATE OR REPLACE FUNCTION prevent_second_hand_purchase_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'gold_app' THEN
    RAISE EXCEPTION 'second_hand_purchases are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER second_hand_purchases_prevent_mutation
  BEFORE UPDATE OR DELETE ON second_hand_purchases
  FOR EACH ROW EXECUTE FUNCTION prevent_second_hand_purchase_mutation();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_second_hand_purchase_item_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'gold_app' THEN
    RAISE EXCEPTION 'second_hand_purchase_items are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER second_hand_purchase_items_prevent_mutation
  BEFORE UPDATE OR DELETE ON second_hand_purchase_items
  FOR EACH ROW EXECUTE FUNCTION prevent_second_hand_purchase_item_mutation();
