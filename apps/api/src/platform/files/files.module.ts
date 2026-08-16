import { Module } from '@nestjs/common';
import { INVOICE_EXPORTER } from './invoice-exporter';
import { PdfInvoiceExporter } from './pdf-invoice-exporter.service';

/** Platform adapter module exported to domain modules through the port only. */
@Module({
  providers: [PdfInvoiceExporter, { provide: INVOICE_EXPORTER, useExisting: PdfInvoiceExporter }],
  exports: [INVOICE_EXPORTER],
})
export class FilesModule {}
