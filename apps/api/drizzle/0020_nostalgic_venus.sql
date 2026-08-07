CREATE TABLE "opening_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_balances_description_nonblank_check" CHECK (length(btrim("opening_balances"."description")) > 0)
);
--> statement-breakpoint
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opening_balances_tenant_effective_at_idx" ON "opening_balances" USING btree ("tenant_id","effective_at");
--> statement-breakpoint
SELECT enable_tenant_rls('opening_balances');
--> statement-breakpoint

-- The source document is historical evidence. An error is corrected by a
-- later source and matching ledger posting, never by rewriting this header.
CREATE OR REPLACE FUNCTION prevent_opening_balance_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'gold_app' THEN
    RAISE EXCEPTION 'opening_balances are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER opening_balances_prevent_mutation
  BEFORE UPDATE OR DELETE ON opening_balances
  FOR EACH ROW EXECUTE FUNCTION prevent_opening_balance_mutation();
