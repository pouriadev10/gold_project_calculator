CREATE TYPE "public"."party_status" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."party_type" AS ENUM('CONSUMER', 'BUSINESS');--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "party_type" NOT NULL,
	"display_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"mobile" text,
	"normalized_mobile" text,
	"national_id" text,
	"linked_tenant_id" uuid,
	"status" "party_status" DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parties_display_name_nonblank_check" CHECK (length(btrim("parties"."display_name")) > 0),
	CONSTRAINT "parties_normalized_name_nonblank_check" CHECK (length(btrim("parties"."normalized_name")) > 0),
	CONSTRAINT "parties_mobile_normalization_pair_check" CHECK (("parties"."mobile" IS NULL) = ("parties"."normalized_mobile" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_linked_tenant_id_tenants_id_fk" FOREIGN KEY ("linked_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parties_tenant_normalized_name_idx" ON "parties" USING btree ("tenant_id","normalized_name");--> statement-breakpoint
CREATE INDEX "parties_tenant_normalized_mobile_idx" ON "parties" USING btree ("tenant_id","normalized_mobile");--> statement-breakpoint
SELECT enable_tenant_rls('parties');
