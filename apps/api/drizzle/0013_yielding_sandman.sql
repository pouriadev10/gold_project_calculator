CREATE TYPE "public"."jewelry_wage_type" AS ENUM('PER_GRAM', 'PERCENT_X100', 'FLAT');--> statement-breakpoint
CREATE TABLE "jewelry_item_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"jewelry_item_id" uuid NOT NULL,
	"title" text NOT NULL,
	"gross_weight_mg" bigint NOT NULL,
	"karat" integer NOT NULL,
	"stone_weight_mg" bigint DEFAULT 0 NOT NULL,
	"other_deduction_weight_mg" bigint DEFAULT 0 NOT NULL,
	"wage_type" "jewelry_wage_type" NOT NULL,
	"wage_value" bigint NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"version" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jewelry_item_versions_gross_weight_positive_check" CHECK ("jewelry_item_versions"."gross_weight_mg" > 0),
	CONSTRAINT "jewelry_item_versions_karat_range_check" CHECK ("jewelry_item_versions"."karat" BETWEEN 1 AND 1000),
	CONSTRAINT "jewelry_item_versions_stone_weight_check" CHECK ("jewelry_item_versions"."stone_weight_mg" >= 0),
	CONSTRAINT "jewelry_item_versions_other_deduction_check" CHECK ("jewelry_item_versions"."other_deduction_weight_mg" >= 0),
	CONSTRAINT "jewelry_item_versions_wage_value_check" CHECK ("jewelry_item_versions"."wage_value" >= 0),
	CONSTRAINT "jewelry_item_versions_deduction_within_gross_check" CHECK ("jewelry_item_versions"."stone_weight_mg" + "jewelry_item_versions"."other_deduction_weight_mg" <= "jewelry_item_versions"."gross_weight_mg"),
	CONSTRAINT "jewelry_item_versions_version_positive_check" CHECK ("jewelry_item_versions"."version" >= 1),
	CONSTRAINT "jewelry_item_versions_valid_interval_check" CHECK ("jewelry_item_versions"."valid_to" IS NULL OR "jewelry_item_versions"."valid_to" > "jewelry_item_versions"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "jewelry_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jewelry_items_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "jewelry_item_versions" ADD CONSTRAINT "jewelry_item_versions_tenant_item_fk" FOREIGN KEY ("tenant_id","jewelry_item_id") REFERENCES "public"."jewelry_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jewelry_items" ADD CONSTRAINT "jewelry_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jewelry_item_versions_tenant_item_version_unique" ON "jewelry_item_versions" USING btree ("tenant_id","jewelry_item_id","version");--> statement-breakpoint
CREATE INDEX "jewelry_item_versions_effective_lookup_idx" ON "jewelry_item_versions" USING btree ("tenant_id","jewelry_item_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "jewelry_items_tenant_code_unique" ON "jewelry_items" USING btree ("tenant_id","code");--> statement-breakpoint
SELECT enable_tenant_rls('jewelry_items');--> statement-breakpoint
SELECT enable_tenant_rls('jewelry_item_versions');