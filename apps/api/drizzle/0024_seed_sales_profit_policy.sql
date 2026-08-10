-- BE-040: existing tenants need the same versioned policy that new tenants
-- receive through INITIAL_TENANT_SETTINGS. It is seed data, never a runtime
-- fallback, so historical pricing remains reproducible.
INSERT INTO "versioned_settings" (
  "tenant_id",
  "setting_key",
  "value_json",
  "valid_from",
  "version",
  "created_by"
)
SELECT
  "id",
  'sales.jewelry_profit_rate_bps',
  '{"value":"700"}'::jsonb,
  "created_at",
  1,
  NULL
FROM "tenants"
WHERE NOT EXISTS (
  SELECT 1
  FROM "versioned_settings"
  WHERE "versioned_settings"."tenant_id" = "tenants"."id"
    AND "versioned_settings"."setting_key" = 'sales.jewelry_profit_rate_bps'
);
