CREATE TYPE "public"."document_type" AS ENUM('SALES_INVOICE');--> statement-breakpoint
CREATE TABLE "document_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_type" "document_type" NOT NULL,
	"period_key" text NOT NULL,
	"current_value" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_counters_current_value_nonnegative_check" CHECK ("document_counters"."current_value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_counters_tenant_type_period_unique" ON "document_counters" USING btree ("tenant_id","document_type","period_key");--> statement-breakpoint

-- BE-038 — مانند هر جدول داده‌ی مستأجر از BE-009 به بعد.
SELECT enable_tenant_rls('document_counters');