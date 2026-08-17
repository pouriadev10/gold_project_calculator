ALTER TABLE "sales_invoice_versions" DROP CONSTRAINT "sales_invoice_versions_tenant_party_fk";
--> statement-breakpoint
ALTER TABLE "sales_invoice_versions" ADD CONSTRAINT "sales_invoice_versions_tenant_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;