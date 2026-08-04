CREATE TYPE "public"."coin_mint_type" AS ENUM('CENTRAL_BANK', 'PRIVATE_MINT', 'OTHER');--> statement-breakpoint
CREATE TABLE "coin_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coin_types_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "coin_type_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"coin_type_id" uuid NOT NULL,
	"title" text NOT NULL,
	"mint_type" "coin_mint_type" NOT NULL,
	"gross_weight_ug" bigint NOT NULL,
	"karat" integer NOT NULL,
	"is_central_bank_minted" boolean NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"version" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coin_type_versions_weight_positive_check" CHECK ("coin_type_versions"."gross_weight_ug" > 0),
	CONSTRAINT "coin_type_versions_karat_range_check" CHECK ("coin_type_versions"."karat" BETWEEN 1 AND 1000),
	CONSTRAINT "coin_type_versions_version_positive_check" CHECK ("coin_type_versions"."version" >= 1),
	CONSTRAINT "coin_type_versions_valid_interval_check" CHECK ("coin_type_versions"."valid_to" IS NULL OR "coin_type_versions"."valid_to" > "coin_type_versions"."valid_from"),
	CONSTRAINT "coin_type_versions_central_bank_mint_check" CHECK ((
        ("coin_type_versions"."is_central_bank_minted" AND "coin_type_versions"."mint_type" = 'CENTRAL_BANK')
        OR
        (NOT "coin_type_versions"."is_central_bank_minted" AND "coin_type_versions"."mint_type" <> 'CENTRAL_BANK')
      ))
);
--> statement-breakpoint
ALTER TABLE "coin_type_versions" ADD CONSTRAINT "coin_type_versions_tenant_coin_type_fk" FOREIGN KEY ("tenant_id","coin_type_id") REFERENCES "public"."coin_types"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coin_types" ADD CONSTRAINT "coin_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coin_type_versions_tenant_type_version_unique" ON "coin_type_versions" USING btree ("tenant_id","coin_type_id","version");--> statement-breakpoint
CREATE INDEX "coin_type_versions_effective_lookup_idx" ON "coin_type_versions" USING btree ("tenant_id","coin_type_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "coin_types_tenant_code_unique" ON "coin_types" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "coin_type_versions"
  ADD CONSTRAINT "coin_type_versions_no_overlapping_validity"
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    "coin_type_id" WITH =,
    tstzrange("valid_from", "valid_to", '[)') WITH &&
  );--> statement-breakpoint
CREATE OR REPLACE FUNCTION restrict_coin_type_version_update() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.valid_to IS NOT NULL
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.coin_type_id IS DISTINCT FROM OLD.coin_type_id
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.mint_type IS DISTINCT FROM OLD.mint_type
    OR NEW.gross_weight_ug IS DISTINCT FROM OLD.gross_weight_ug
    OR NEW.karat IS DISTINCT FROM OLD.karat
    OR NEW.is_central_bank_minted IS DISTINCT FROM OLD.is_central_bank_minted
    OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.active IS DISTINCT FROM OLD.active
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.valid_to IS NULL
    OR NEW.valid_to <= OLD.valid_from
  THEN
    RAISE EXCEPTION 'coin type version records are immutable except for closing an open interval'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER coin_type_versions_restrict_update
  BEFORE UPDATE ON "coin_type_versions"
  FOR EACH ROW EXECUTE FUNCTION restrict_coin_type_version_update();--> statement-breakpoint
WITH coin_seed(code, title, mint_type, gross_weight_ug, karat, is_central_bank_minted) AS (
  VALUES
    ('BAHAR_AZADI_NEW', 'تمام بهار آزادی (طرح جدید)', 'CENTRAL_BANK'::coin_mint_type, 8133000::bigint, 900, true),
    ('NIM_BAHAR_AZADI', 'نیم سکه بهار آزادی', 'CENTRAL_BANK'::coin_mint_type, 4066500::bigint, 900, true),
    ('ROB_BAHAR_AZADI', 'ربع سکه بهار آزادی', 'CENTRAL_BANK'::coin_mint_type, 2033200::bigint, 900, true),
    ('GERAMI', 'سکه گرمی', 'CENTRAL_BANK'::coin_mint_type, 1016600::bigint, 900, true)
)
INSERT INTO coin_types (tenant_id, code, created_at)
SELECT tenants.id, coin_seed.code, tenants.created_at
FROM tenants
CROSS JOIN coin_seed
ON CONFLICT (tenant_id, code) DO NOTHING;--> statement-breakpoint
WITH coin_seed(code, title, mint_type, gross_weight_ug, karat, is_central_bank_minted) AS (
  VALUES
    ('BAHAR_AZADI_NEW', 'تمام بهار آزادی (طرح جدید)', 'CENTRAL_BANK'::coin_mint_type, 8133000::bigint, 900, true),
    ('NIM_BAHAR_AZADI', 'نیم سکه بهار آزادی', 'CENTRAL_BANK'::coin_mint_type, 4066500::bigint, 900, true),
    ('ROB_BAHAR_AZADI', 'ربع سکه بهار آزادی', 'CENTRAL_BANK'::coin_mint_type, 2033200::bigint, 900, true),
    ('GERAMI', 'سکه گرمی', 'CENTRAL_BANK'::coin_mint_type, 1016600::bigint, 900, true)
)
INSERT INTO coin_type_versions (
  tenant_id,
  coin_type_id,
  title,
  mint_type,
  gross_weight_ug,
  karat,
  is_central_bank_minted,
  valid_from,
  version,
  active,
  created_at
)
SELECT
  coin_types.tenant_id,
  coin_types.id,
  coin_seed.title,
  coin_seed.mint_type,
  coin_seed.gross_weight_ug,
  coin_seed.karat,
  coin_seed.is_central_bank_minted,
  coin_types.created_at,
  1,
  true,
  coin_types.created_at
FROM coin_types
INNER JOIN coin_seed ON coin_seed.code = coin_types.code
ON CONFLICT (tenant_id, coin_type_id, version) DO NOTHING;--> statement-breakpoint
SELECT enable_tenant_rls('coin_types');--> statement-breakpoint
SELECT enable_tenant_rls('coin_type_versions');
