import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { formatExportLine } from '../../platform/files/pdf-invoice-exporter.service';
import { PartyStatementPdfService } from './party-statement-pdf.service';
import type { DocumentIssuerService } from '../../platform/files/document-issuer.service';
import type { InvoiceExportInput, InvoiceExporter } from '../../platform/files/invoice-exporter';
import type { PartiesService } from './parties.service';
import type { PartyStatementExport, PartyStatementsService } from './party-statements.service';

const PARTY_ID = 'a1000000-0000-4000-8000-000000000001';
const COIN_TYPE_ID = 'c3000000-0000-4000-8000-000000000001';
const DIMENSIONS = {
  rial: { id: 'd2000000-0000-4000-8000-000000000001', code: 'RIAL', kind: 'RIAL', coinTypeId: null, coinCode: null },
  gold: { id: 'd2000000-0000-4000-8000-000000000002', code: 'GOLD', kind: 'GOLD', coinTypeId: null, coinCode: null },
  coin: {
    id: 'd2000000-0000-4000-8000-000000000003',
    code: `COIN:${COIN_TYPE_ID}`,
    kind: 'COIN',
    coinTypeId: COIN_TYPE_ID,
    coinCode: 'BAHAR_AZADI_NEW',
  },
} as const;

function entry(
  dimension: (typeof DIMENSIONS)[keyof typeof DIMENSIONS],
  sourceType: PartyStatementExport['items'][number]['source']['type'],
  quantity: string,
  runningBalance: string,
): PartyStatementExport['items'][number] {
  return {
    ledgerTransactionId: 'e1000000-0000-4000-8000-000000000001',
    source: { type: sourceType, id: 'f1000000-0000-4000-8000-000000000001' },
    effectiveAt: '2026-10-20T08:00:00.000Z',
    description: `Second-hand coin purchase f1000000-0000-4000-8000-000000000001`,
    dimension,
    quantity,
    runningBalance,
    documentRateSnapshots: [],
  };
}

async function exportedInput(items: PartyStatementExport['items']): Promise<InvoiceExportInput> {
  let captured: InvoiceExportInput | undefined;
  const exporter: InvoiceExporter = {
    exportInvoice: async (input) => {
      captured = input;
      return { content: Buffer.from('%PDF-'), contentType: 'application/pdf', fileName: 'x.pdf' };
    },
  };
  const statement: PartyStatementExport = {
    partyId: PARTY_ID,
    items,
    dimensionTitles: new Map([
      [DIMENSIONS.rial.id, 'ریال'],
      [DIMENSIONS.gold.id, 'طلای خالص ۱۰۰۰'],
      [DIMENSIONS.coin.id, 'تمام بهار آزادی (طرح جدید)'],
    ]),
  };
  const service = new PartyStatementPdfService(
    { findById: async () => ({ id: PARTY_ID, displayName: 'حسین مرادی', mobile: null }) } as unknown as PartiesService,
    { getStatementForExport: async () => statement } as unknown as PartyStatementsService,
    {
      getIssuer: async () => ({ displayName: 'طلافروشی', mobile: null, timeZone: 'Asia/Tehran' }),
    } as unknown as DocumentIssuerService,
    exporter,
  );
  await service.export('t', PARTY_ID);
  if (captured === undefined) throw new Error('exporter was not called');
  return captured;
}

describe('PartyStatementPdfService — خطوط فارسی صورت‌حساب (M-15)', () => {
  it('هر خط تاریخ، نوع سند، عنوان فارسی بُعد با واحد، تغییر و مانده دارد — بی‌شرح انگلیسی و شناسه', async () => {
    const input = await exportedInput([
      entry(DIMENSIONS.rial, 'SALES_INVOICE', '100000000', '100000000'),
      entry(DIMENSIONS.gold, 'SETTLEMENT', '-2500', '7500'),
      entry(DIMENSIONS.coin, 'SECOND_HAND_PURCHASE', '-1', '-1'),
    ]);

    expect(input.lines.map((line) => line.title)).toEqual([
      'فاکتور فروش · ریال',
      'تسویه · طلای خالص ۱۰۰۰ (میلی‌گرم)',
      'خرید دست‌دوم · تمام بهار آزادی (طرح جدید) (عدد)',
    ]);
    for (const line of input.lines) {
      expect(line.title).not.toMatch(/[A-Za-z]|[0-9a-f]{8}-/u);
      expect(line).toMatchObject({ quantityLabel: 'تغییر', amountRial: null });
      expect(line.occurredAt).toEqual(new Date('2026-10-20T08:00:00.000Z'));
    }
    expect(input.lines.map((line) => [line.quantity, line.balance])).toEqual([
      ['100000000', '100000000'],
      ['-2500', '7500'],
      ['-1', '-1'],
    ]);
  });

  it('خط صورت‌حساب «تغییر» و «مانده» چاپ می‌کند، بی «مبلغ: -»', () => {
    const text = formatExportLine(
      {
        title: 'تسویه · طلای خالص ۱۰۰۰ (میلی‌گرم)',
        quantityLabel: 'تغییر',
        quantity: '-2500',
        amountRial: null,
        balance: '7500',
        occurredAt: new Date('2026-10-20T08:00:00.000Z'),
      },
      'Asia/Tehran',
    );
    // تاریخ اول می‌آید، بعد عنوان؛ علامت منفی هر شکلی که Intl بدهد بماند.
    expect(text).toMatch(/^[^|]+ \| تسویه · طلای خالص ۱۰۰۰ \(میلی‌گرم\) \| تغییر: .*۲٬۵۰۰ \| مانده: ۷٬۵۰۰$/u);
    expect(text.split(' | ')[0]).toContain('۱۴۰۵');
    expect(text).not.toContain('مبلغ');
  });

  it('خط فاکتور همان شکل قبلی را دارد', () => {
    expect(formatExportLine({ title: 'انگشتر طلا', quantity: '1', amountRial: '75000000' }, 'Asia/Tehran')).toBe(
      'انگشتر طلا | مقدار: ۱ | مبلغ: ۷۵٬۰۰۰٬۰۰۰ ریال',
    );
  });
});
