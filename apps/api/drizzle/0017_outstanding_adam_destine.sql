CREATE TYPE "public"."ledger_account_type" AS ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'CLEARING');--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"account_type" "ledger_account_type" NOT NULL,
	"party_id" uuid,
	"system_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "ledger_accounts_code_nonblank_check" CHECK (length(btrim("ledger_accounts"."code")) > 0),
	CONSTRAINT "ledger_accounts_title_nonblank_check" CHECK (length(btrim("ledger_accounts"."title")) > 0),
	CONSTRAINT "ledger_accounts_party_account_type_check" CHECK ("ledger_accounts"."party_id" IS NULL OR "ledger_accounts"."account_type" IN ('ASSET', 'LIABILITY')),
	CONSTRAINT "ledger_accounts_party_system_key_check" CHECK ("ledger_accounts"."party_id" IS NULL OR "ledger_accounts"."system_key" IS NULL)
);
--> statement-breakpoint
-- FK مرکب حساب شخص به کلید یکتای هم‌مستأجر Party نیاز دارد؛ باید پیش از
-- ساختن FK افزوده شود، نه بعد از آن.
ALTER TABLE "parties" ADD CONSTRAINT "parties_tenant_id_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_tenant_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_tenant_code_unique" ON "ledger_accounts" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_tenant_system_key_unique" ON "ledger_accounts" USING btree ("tenant_id","system_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_tenant_party_type_unique" ON "ledger_accounts" USING btree ("tenant_id","party_id","account_type");--> statement-breakpoint

-- BE-031 — chart اولیه برای tenantهای موجود هم باید دقیقاً با tenantهای تازه
-- یکی باشد. این کلیدها قرارداد posting هستند؛ رقم، نرخ یا عیار ندارند.
INSERT INTO "ledger_accounts" (
  "tenant_id",
  "code",
  "title",
  "account_type",
  "system_key",
  "active"
)
SELECT
  "tenants"."id",
  "seed"."code",
  "seed"."title",
  "seed"."account_type",
  "seed"."system_key",
  true
FROM "tenants"
CROSS JOIN (
  VALUES
    ('ASSET:CASH', 'صندوق ریالی', 'ASSET'::"ledger_account_type", 'CASH'),
    ('ASSET:BANK', 'بانک', 'ASSET'::"ledger_account_type", 'BANK'),
    ('ASSET:INVENTORY_JEWELRY', 'موجودی مصنوعات', 'ASSET'::"ledger_account_type", 'INVENTORY_JEWELRY'),
    ('ASSET:INVENTORY_MELTED_GOLD', 'موجودی آبشده', 'ASSET'::"ledger_account_type", 'INVENTORY_MELTED_GOLD'),
    ('ASSET:ACCOUNTS_RECEIVABLE_CONTROL', 'کنترل حساب‌های دریافتنی اشخاص', 'ASSET'::"ledger_account_type", 'ACCOUNTS_RECEIVABLE_CONTROL'),
    ('LIABILITY:ACCOUNTS_PAYABLE_CONTROL', 'کنترل حساب‌های پرداختنی اشخاص', 'LIABILITY'::"ledger_account_type", 'ACCOUNTS_PAYABLE_CONTROL'),
    ('REVENUE:SALES', 'فروش', 'REVENUE'::"ledger_account_type", 'SALES_REVENUE'),
    ('REVENUE:WAGE', 'اجرت', 'REVENUE'::"ledger_account_type", 'WAGE_REVENUE'),
    ('EXPENSE:COGS_JEWELRY', 'بهای خروج مصنوعات', 'EXPENSE'::"ledger_account_type", 'COGS_JEWELRY'),
    ('EXPENSE:COGS_COIN', 'بهای خروج سکه', 'EXPENSE'::"ledger_account_type", 'COGS_COIN'),
    ('EXPENSE:PURCHASE_FROM_CONSUMER', 'خرید از مصرف‌کننده', 'EXPENSE'::"ledger_account_type", 'PURCHASE_FROM_CONSUMER'),
    ('LIABILITY:TAX_PAYABLE', 'مالیات پرداختنی', 'LIABILITY'::"ledger_account_type", 'TAX_PAYABLE'),
    ('EQUITY:OPENING', 'حساب افتتاحیه', 'EQUITY'::"ledger_account_type", 'OPENING_EQUITY'),
    ('EQUITY:PROFIT_LOSS', 'سود و زیان', 'EQUITY'::"ledger_account_type", 'PROFIT_LOSS'),
    ('CLEARING:SETTLEMENT_CONVERSION', 'تبدیل تسویه', 'CLEARING'::"ledger_account_type", 'SETTLEMENT_CONVERSION_CLEARING')
) AS "seed"("code", "title", "account_type", "system_key")
ON CONFLICT ("tenant_id", "system_key") DO NOTHING;--> statement-breakpoint

-- حساب سکه هم مثل dimension آن یک هویت شمارشی مستقل دارد؛ هرگز از وزن سکه
-- یا نرخ مظنه برای ساختن آن استفاده نمی‌شود.
INSERT INTO "ledger_accounts" (
  "tenant_id",
  "code",
  "title",
  "account_type",
  "system_key",
  "active"
)
SELECT
  "coin_types"."tenant_id",
  'ASSET:INVENTORY_COIN:' || "coin_types"."id"::text,
  'موجودی ' || COALESCE("current_version"."title", "coin_types"."code"),
  'ASSET'::"ledger_account_type",
  'INVENTORY_COIN:' || "coin_types"."id"::text,
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
ON CONFLICT ("tenant_id", "system_key") DO NOTHING;--> statement-breakpoint

SELECT enable_tenant_rls('ledger_accounts');
