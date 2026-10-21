import { Inject, Injectable } from '@nestjs/common';
import { DocumentIssuerService } from '../../platform/files/document-issuer.service';
import { INVOICE_EXPORTER } from '../../platform/files/invoice-exporter';
import { PartyNotFoundError, PartiesService } from './parties.service';
import { PartyStatementsService } from './party-statements.service';
import type {
  ExportedFile,
  InvoiceExporter,
  InvoiceSnapshotValue,
} from '../../platform/files/invoice-exporter';
import type { PartyStatementExport } from './party-statements.service';

type StatementItem = PartyStatementExport['items'][number];

/**
 * نوع سند به فارسی — همان برچسب‌های صفحه‌ی صورت‌حساب (`SOURCE_LABEL` ِ فرانت). پیش از M-15
 * PDF ِ مشتری شرح فنی انگلیسی دفتر کل («Second-hand coin purchase <uuid>») را چاپ می‌کرد.
 */
const SOURCE_LABEL: Record<StatementItem['source']['type'], string> = {
  OPENING_BALANCE: 'مانده افتتاحیه',
  SALES_INVOICE: 'فاکتور فروش',
  SECOND_HAND_PURCHASE: 'خرید دست‌دوم',
  SETTLEMENT: 'تسویه',
  SALES_INVOICE_AMENDMENT: 'اصلاح فاکتور',
  LEDGER_REVERSAL: 'برگشت سند',
};

/** واحد عددهای هر بُعد؛ ریال خودش واحد است. */
const UNIT_SUFFIX: Record<StatementItem['dimension']['kind'], string> = {
  RIAL: '',
  GOLD: ' (میلی‌گرم)',
  SILVER: ' (میلی‌گرم)',
  COIN: ' (عدد)',
};

function lineTitle(item: StatementItem, titles: ReadonlyMap<string, string>): string {
  const dimension = titles.get(item.dimension.id) ?? item.dimension.coinCode ?? item.dimension.code;
  return `${SOURCE_LABEL[item.source.type]} · ${dimension}${UNIT_SUFFIX[item.dimension.kind]}`;
}

function snapshotValue(value: unknown): InvoiceSnapshotValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return value.toString();
  if (Array.isArray(value)) return value.map(snapshotValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, snapshotValue(nested)]),
    );
  }
  return String(value);
}

/** Builds a tenant-isolated party statement document from the ledger projection. */
@Injectable()
export class PartyStatementPdfService {
  constructor(
    @Inject(PartiesService) private readonly parties: PartiesService,
    @Inject(PartyStatementsService) private readonly statements: PartyStatementsService,
    @Inject(DocumentIssuerService) private readonly issuer: DocumentIssuerService,
    @Inject(INVOICE_EXPORTER) private readonly exporter: InvoiceExporter,
  ) {}

  async export(tenantId: string, partyId: string): Promise<ExportedFile> {
    const [party, statement, issuer] = await Promise.all([
      this.parties.findById(tenantId, partyId),
      this.statements.getStatementForExport(tenantId, partyId),
      this.issuer.getIssuer(tenantId),
    ]);
    if (party === undefined) throw new PartyNotFoundError();

    const issuedAt = statement.items.at(-1)?.effectiveAt;
    return this.exporter.exportInvoice({
      title: 'صورت‌حساب شخص',
      documentNumber: party.id,
      fileNameStem: `statement-${party.id.slice(0, 8)}`,
      issuedAt: issuedAt === undefined ? new Date() : new Date(issuedAt),
      issuer,
      recipient: { displayName: party.displayName, mobile: party.mobile },
      lockedQuote: null,
      lines: statement.items.map((item) => ({
        occurredAt: new Date(item.effectiveAt),
        title: lineTitle(item, statement.dimensionTitles),
        quantityLabel: 'تغییر',
        quantity: item.quantity,
        amountRial: null,
        balance: item.runningBalance,
      })),
      historicalSnapshot: {
        entries: statement.items.map((item) => ({
          sourceType: item.source.type,
          sourceId: item.source.id,
          effectiveAt: item.effectiveAt,
          quantity: item.quantity,
          runningBalance: item.runningBalance,
          documentRateSnapshots: snapshotValue(item.documentRateSnapshots),
        })),
      },
    });
  }
}
