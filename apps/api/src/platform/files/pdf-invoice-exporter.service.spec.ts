import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { DocumentIssuerService } from './document-issuer.service';
import { FilesModule } from './files.module';
import { INVOICE_EXPORTER, type InvoiceExporter } from './invoice-exporter';
import { PdfInvoiceExporter } from './pdf-invoice-exporter.service';

function unicodeFromCMap(pdf: Buffer): string {
  const cmap = pdf.toString('ascii').match(/begincidchar\n([\s\S]*?)\nendcidchar/);
  if (cmap === null) return '';

  return [...cmap[1]!.matchAll(/<[0-9A-F]{4}> <([0-9A-F]{4})>/g)]
    .map((match) => String.fromCodePoint(Number.parseInt(match[1]!, 16)))
    .join('');
}

describe('PdfInvoiceExporter', () => {
  it('exports a PDF with the embedded project font and historical snapshot', async () => {
    const exporter = new PdfInvoiceExporter();

    const exported = await exporter.exportInvoice({
      title: 'فاکتور فروش',
      documentNumber: 'S-1405-00001',
      issuedAt: new Date('2026-08-16T08:30:00.000Z'),
      issuer: { displayName: 'طلافروشی آزمون', mobile: '09120000000' },
      recipient: { displayName: 'مشتری آزمون', mobile: null },
      lockedQuote: {
        amountRial: '125000000',
        observedAt: new Date('2026-08-16T08:15:00.000Z'),
      },
      lines: [{ title: 'انگشتر طلا', quantity: '1', amountRial: '75000000' }],
      historicalSnapshot: {
        rateSnapshotMarker: 'HISTORY-7788',
        amountRial: '125000000',
        weightMg: '4125',
      },
    });

    const rawPdf = exported.content.toString('ascii');
    expect(exported.fileName).toBe('invoice-S-1405-00001.pdf');
    expect(exported.contentType).toBe('application/pdf');
    expect(exported.content.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(rawPdf).toContain('/BaseFont /Vazirmatn');
    expect(rawPdf).toContain('/FontFile2');
    expect(rawPdf).toContain('/ToUnicode');
    const renderedSnapshot = unicodeFromCMap(exported.content);
    expect(renderedSnapshot).toContain('HISTORY');
    expect(renderedSnapshot).toContain('7788');
  });

  it('provides the renderer through the InvoiceExporter port', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FilesModule] })
      .overrideProvider(DocumentIssuerService)
      .useValue({})
      .compile();

    expect(moduleRef.get<InvoiceExporter>(INVOICE_EXPORTER)).toBeInstanceOf(PdfInvoiceExporter);
    await moduleRef.close();
  });

  it('paginates a long statement without inventing a quote', async () => {
    const exported = await new PdfInvoiceExporter().exportInvoice({
      title: 'صورت‌حساب شخص',
      documentNumber: 'statement-1',
      issuedAt: new Date('2026-08-16T08:30:00.000Z'),
      issuer: { displayName: 'فروشگاه آزمون', mobile: null },
      recipient: { displayName: 'مشتری آزمون', mobile: null },
      lockedQuote: null,
      lines: Array.from({ length: 36 }, (_, index) => ({
        title: `statement-line-${index + 1}`,
        quantity: '1',
        amountRial: null,
      })),
      historicalSnapshot: { immutable: 'statement-history' },
    });

    const rawPdf = exported.content.toString('ascii');
    expect(rawPdf).toContain('/Count 2');
    const renderedSnapshot = unicodeFromCMap(exported.content);
    expect(renderedSnapshot).toContain('statement');
    expect(renderedSnapshot).toContain('history');
  });
});
