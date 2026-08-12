ALTER TABLE "settlement_lines" DROP CONSTRAINT "settlement_lines_tenant_dimension_fk";
--> statement-breakpoint
ALTER TABLE "settlement_lines" DROP CONSTRAINT "settlement_lines_tenant_source_account_fk";
--> statement-breakpoint
ALTER TABLE "settlement_lines" DROP CONSTRAINT "settlement_lines_tenant_destination_account_fk";
--> statement-breakpoint
ALTER TABLE "settlement_lines" DROP CONSTRAINT "settlement_lines_tenant_quote_fk";
--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_tenant_dimension_fk" FOREIGN KEY ("tenant_id","dimension_id") REFERENCES "public"."asset_dimensions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_tenant_source_account_fk" FOREIGN KEY ("tenant_id","source_account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_tenant_destination_account_fk" FOREIGN KEY ("tenant_id","destination_account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_tenant_quote_fk" FOREIGN KEY ("tenant_id","locked_quote_id") REFERENCES "public"."price_quotes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;