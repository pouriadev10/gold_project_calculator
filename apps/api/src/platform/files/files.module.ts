import { Module } from '@nestjs/common';
import { DocumentIssuerService } from './document-issuer.service';
import { INVOICE_EXPORTER } from './invoice-exporter';
import { PdfInvoiceExporter } from './pdf-invoice-exporter.service';

/** Platform adapter module exported to domain modules through the port only. */
@Module({
  providers: [
    DocumentIssuerService,
    PdfInvoiceExporter,
    { provide: INVOICE_EXPORTER, useExisting: PdfInvoiceExporter },
  ],
  exports: [DocumentIssuerService, INVOICE_EXPORTER],
})
export class FilesModule {}
