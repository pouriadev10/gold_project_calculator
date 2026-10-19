CREATE TABLE "tenant_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_by" uuid,
	"schema_version" integer NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"content" text NOT NULL,
	"content_sha256" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"row_counts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_exports_schema_version_positive_check" CHECK ("tenant_exports"."schema_version" > 0),
	CONSTRAINT "tenant_exports_sha256_format_check" CHECK ("tenant_exports"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "tenant_exports_byte_size_check" CHECK ("tenant_exports"."byte_size" = octet_length("tenant_exports"."content"))
);
--> statement-breakpoint
ALTER TABLE "tenant_exports" ADD CONSTRAINT "tenant_exports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_exports" ADD CONSTRAINT "tenant_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_exports_tenant_created_at_idx" ON "tenant_exports" USING btree ("tenant_id","created_at");--> statement-breakpoint
SELECT enable_tenant_rls('tenant_exports');--> statement-breakpoint
-- یک خروجی گرفته‌شده سند است: دانلود دوم باید همان بایت‌ها و همان sha256 باشد.
CREATE TRIGGER tenant_exports_prevent_mutation
  BEFORE UPDATE OR DELETE ON tenant_exports
  FOR EACH ROW EXECUTE FUNCTION enforce_append_only('requested_by');
