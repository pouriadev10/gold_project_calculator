ALTER TABLE "sales_invoice_versions" ADD COLUMN "reason_detail" text;--> statement-breakpoint
ALTER TABLE "sales_invoice_versions" ADD COLUMN "party_id" uuid;--> statement-breakpoint
UPDATE "sales_invoice_versions" AS version
SET "party_id" = invoice."party_id"
FROM "sales_invoices" AS invoice
WHERE invoice."id" = version."sales_invoice_id"
  AND invoice."tenant_id" = version."tenant_id";--> statement-breakpoint
ALTER TABLE "sales_invoice_versions" ALTER COLUMN "party_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoice_versions" ADD CONSTRAINT "sales_invoice_versions_tenant_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_invoice_versions_tenant_party_idx" ON "sales_invoice_versions" USING btree ("tenant_id","party_id");--> statement-breakpoint
ALTER TABLE "sales_invoice_versions" ADD CONSTRAINT "sales_invoice_versions_other_reason_detail_check" CHECK ("sales_invoice_versions"."reason" IS DISTINCT FROM 'OTHER' OR length(btrim("sales_invoice_versions"."reason_detail")) > 0);
