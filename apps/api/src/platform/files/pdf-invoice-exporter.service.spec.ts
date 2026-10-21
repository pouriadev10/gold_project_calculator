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
      issuer: { displayName: 'طلافروشی آزمون', mobile: '09120000000', timeZone: 'Asia/Tehran' },
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
      fileNameStem: 'statement-ab12cd34',
      issuedAt: new Date('2026-08-16T08:30:00.000Z'),
      issuer: { displayName: 'فروشگاه آزمون', mobile: null, timeZone: 'Asia/Tehran' },
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
    expect(exported.fileName).toBe('statement-ab12cd34.pdf'); // #16: نه invoice-…
    const renderedSnapshot = unicodeFromCMap(exported.content);
    expect(renderedSnapshot).toContain('statement');
    expect(renderedSnapshot).toContain('history');
  });
});

describe('PdfInvoiceExporter — شکل حروف فارسی (M-10)', () => {
  async function renderedGlyphs(recipient: string, timeZone = 'Asia/Tehran'): Promise<string> {
    const exported = await new PdfInvoiceExporter().exportInvoice({
      title: 'رسید',
      documentNumber: '1405-1',
      issuedAt: new Date('2026-08-16T08:30:00.000Z'),
      issuer: { displayName: 'فروشگاه', mobile: null, timeZone },
      recipient: { displayName: recipient, mobile: null },
      lockedQuote: null,
      lines: [],
      historicalSnapshot: {},
    });
    return unicodeFromCMap(exported.content);
  }

  it('«ئ» با حروف کناری وصل می‌شود: میانی در «مسئول»، آغازین پس از «ر» در «رئیسی»', async () => {
    const medial = await renderedGlyphs('مسئول');
    expect(medial).toContain('ﺌ'); // ئ میانی
    expect(medial).not.toContain('ئ'); // ئ ِ بی‌شکل
    // «ر» به چپ وصل نمی‌شود، پس «ئ» بعد از آن آغازین است — نه میانی.
    const initial = await renderedGlyphs('رئیسی');
    expect(initial).toContain('ﺋ');
    expect(initial).not.toContain('ئ');
  });

  it('«أ ؤ إ ة» شکل پایانی خود را می‌گیرند', async () => {
    const glyphs = await renderedGlyphs('سأل مؤمن بإذن فاطمة');
    for (const finalForm of ['ﺄ', 'ﺆ', 'ﺈ', 'ﺔ']) expect(glyphs).toContain(finalForm);
    for (const bare of ['أ', 'ؤ', 'إ', 'ة']) expect(glyphs).not.toContain(bare);
  });
});

describe('PdfInvoiceExporter — تاریخ در منطقه‌ی مستأجر (M-10)', () => {
  it('همان لحظه برای مستأجر UTC و تهران دو تاریخ متفاوت چاپ می‌کند', async () => {
    const render = async (timeZone: string) => {
      const exported = await new PdfInvoiceExporter().exportInvoice({
        title: 'رسید',
        documentNumber: '1405-1',
        // ۲۲:۳۰ UTC ِ ۲۵ مرداد = ۰۳:۰۰ بامداد ۲۶ مرداد به وقت تهران
        issuedAt: new Date('2026-08-16T22:30:00.000Z'),
        issuer: { displayName: 'فروشگاه', mobile: null, timeZone },
        recipient: { displayName: 'مشتری', mobile: null },
        lockedQuote: null,
        lines: [],
        historicalSnapshot: {},
      });
      return exported.content.toString('latin1');
    };
    expect(await render('UTC')).toEqual(await render('UTC')); // خروجی قطعی است، پس تفاوت پایین فقط از تاریخ است
    expect(await render('UTC')).not.toEqual(await render('Asia/Tehran'));
  });
});
