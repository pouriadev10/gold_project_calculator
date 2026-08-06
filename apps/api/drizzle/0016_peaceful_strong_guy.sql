CREATE TYPE "public"."asset_dimension_kind" AS ENUM('RIAL', 'GOLD', 'SILVER', 'COIN');--> statement-breakpoint
CREATE TABLE "asset_dimensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"code" text NOT NULL,
	"kind" "asset_dimension_kind" NOT NULL,
	"coin_type_id" uuid,
	"title" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_dimensions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "asset_dimensions_code_nonblank_check" CHECK (length(btrim("asset_dimensions"."code")) > 0),
	CONSTRAINT "asset_dimensions_title_nonblank_check" CHECK (length(btrim("asset_dimensions"."title")) > 0),
	CONSTRAINT "asset_dimensions_coin_identity_check" CHECK (("asset_dimensions"."kind" = 'COIN') = ("asset_dimensions"."coin_type_id" IS NOT NULL)),
	CONSTRAINT "asset_dimensions_coin_tenant_check" CHECK ("asset_dimensions"."kind" <> 'COIN' OR "asset_dimensions"."tenant_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "asset_dimensions" ADD CONSTRAINT "asset_dimensions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_dimensions" ADD CONSTRAINT "asset_dimensions_tenant_coin_type_fk" FOREIGN KEY ("tenant_id","coin_type_id") REFERENCES "public"."coin_types"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_dimensions_tenant_code_unique" ON "asset_dimensions" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_dimensions_tenant_coin_type_unique" ON "asset_dimensions" USING btree ("tenant_id","coin_type_id");--> statement-breakpoint
-- BE-030 — هر tenant باید از همان لحظه‌ی migration پایه‌های دفتر برداری را
-- داشته باشد. ردیف‌های قدیمی هم قبل از NOT NULL شدن `dimension_id` backfill
-- می‌شوند تا migration روی داده‌ی واقعی بی‌صدا آن‌ها را خراب نکند.
INSERT INTO "asset_dimensions" ("tenant_id", "code", "kind", "title", "active")
SELECT
  "tenants"."id",
  "base"."code",
  "base"."kind",
  "base"."title",
  true
FROM "tenants"
CROSS JOIN (
  VALUES
    ('RIAL'::"asset_dimension_kind", 'RIAL', 'ریال'),
    ('GOLD'::"asset_dimension_kind", 'GOLD', 'طلای خالص ۱۰۰۰'),
    ('SILVER'::"asset_dimension_kind", 'SILVER', 'نقرهٔ خالص ۱۰۰۰')
) AS "base"("kind", "code", "title")
ON CONFLICT ("tenant_id", "code") DO NOTHING;--> statement-breakpoint

-- حتی اگر نوع سکه دیگر active نباشد، dimension آن برای تاریخچه و movementهای
-- قبلی باقی می‌ماند. مقدار active فقط انتخاب‌پذیری عملیاتی آینده را نشان می‌دهد.
INSERT INTO "asset_dimensions" (
  "tenant_id",
  "code",
  "kind",
  "coin_type_id",
  "title",
  "active"
)
SELECT
  "coin_types"."tenant_id",
  'COIN:' || "coin_types"."id"::text,
  'COIN'::"asset_dimension_kind",
  "coin_types"."id",
  COALESCE("current_version"."title", "coin_types"."code"),
  COALESCE("current_version"."active", false)
FROM "coin_types"
LEFT JOIN LATERAL (
  SELECT "title", "active"
  FROM "coin_type_versions"
  WHERE "coin_type_versions"."tenant_id" = "coin_types"."tenant_id"
    AND "coin_type_versions"."coin_type_id" = "coin_types"."id"
  ORDER BY "coin_type_versions"."version" DESC
  LIMIT 1
) AS "current_version" ON true
ON CONFLICT ("tenant_id", "coin_type_id") DO NOTHING;--> statement-breakpoint

UPDATE "inventory_movements" AS "movement"
SET "dimension_id" = "dimension"."id"
FROM "asset_dimensions" AS "dimension"
WHERE "movement"."dimension_id" IS NULL
  AND "dimension"."tenant_id" = "movement"."tenant_id"
  AND (
    (
      "movement"."item_type" IN ('JEWELRY', 'MELTED_GOLD')
      AND "dimension"."kind" = 'GOLD'
      AND "dimension"."coin_type_id" IS NULL
    )
    OR (
      "movement"."item_type" = 'COIN'
      AND "dimension"."kind" = 'COIN'
      AND "dimension"."coin_type_id" = "movement"."item_id"
    )
  );--> statement-breakpoint

ALTER TABLE "inventory_movements" ALTER COLUMN "dimension_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_dimension_fk" FOREIGN KEY ("tenant_id","dimension_id") REFERENCES "public"."asset_dimensions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
SELECT enable_tenant_rls('asset_dimensions');--> statement-breakpoint

-- identity بعد سکه immutable است: هیچ SQL مستقیمی هم نمی‌تواند دو coin type
-- را به یک بعد تبدیل کند. title و active برای نام/وضعیت فعلی قابل sync هستند.
CREATE OR REPLACE FUNCTION prevent_asset_dimension_identity_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.code IS DISTINCT FROM OLD.code
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.coin_type_id IS DISTINCT FROM OLD.coin_type_id THEN
    RAISE EXCEPTION 'asset dimension identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER asset_dimensions_prevent_identity_mutation
  BEFORE UPDATE ON "asset_dimensions"
  FOR EACH ROW EXECUTE FUNCTION prevent_asset_dimension_identity_mutation();
