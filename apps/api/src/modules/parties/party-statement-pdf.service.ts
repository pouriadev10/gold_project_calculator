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
      issuedAt: issuedAt === undefined ? new Date() : new Date(issuedAt),
      issuer,
      recipient: { displayName: party.displayName, mobile: party.mobile },
      lockedQuote: null,
      lines: statement.items.map((item) => ({
        title: `${item.description} | ${item.dimension.code}`,
        quantity: item.runningBalance,
        amountRial: item.dimension.kind === 'RIAL' ? item.quantity : null,
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
