CREATE TABLE "versioned_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"setting_key" text NOT NULL,
	"value_json" jsonb NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"version" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "versioned_settings_valid_interval_check" CHECK ("versioned_settings"."valid_to" IS NULL OR "versioned_settings"."valid_to" > "versioned_settings"."valid_from"),
	CONSTRAINT "versioned_settings_version_positive_check" CHECK ("versioned_settings"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "versioned_settings" ADD CONSTRAINT "versioned_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versioned_settings" ADD CONSTRAINT "versioned_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "versioned_settings_tenant_key_version_unique" ON "versioned_settings" USING btree ("tenant_id","setting_key","version");--> statement-breakpoint
CREATE INDEX "versioned_settings_effective_lookup_idx" ON "versioned_settings" USING btree ("tenant_id","setting_key","valid_from");
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "versioned_settings"
  ADD CONSTRAINT "versioned_settings_no_overlapping_validity"
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    "setting_key" WITH =,
    tstzrange("valid_from", "valid_to", '[)') WITH &&
  );
--> statement-breakpoint
SELECT enable_tenant_rls('versioned_settings');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION restrict_versioned_setting_update() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  -- نسخه‌ی تاریخی هرگز بازنویسی نمی‌شود. تنها تغییر مجاز این است که
  -- service در همان transaction یک نسخه‌ی باز را با `valid_to` ببندد.
  IF OLD.valid_to IS NOT NULL
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.setting_key IS DISTINCT FROM OLD.setting_key
    OR NEW.value_json IS DISTINCT FROM OLD.value_json
    OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.valid_to IS NULL
    OR NEW.valid_to <= OLD.valid_from
  THEN
    RAISE EXCEPTION 'versioned setting records are immutable except for closing an open interval'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER versioned_settings_restrict_update
  BEFORE UPDATE ON "versioned_settings"
  FOR EACH ROW EXECUTE FUNCTION restrict_versioned_setting_update();
