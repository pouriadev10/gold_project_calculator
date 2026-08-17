import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DocumentIssuerService } from '../../platform/files/document-issuer.service';
import { INVOICE_EXPORTER } from '../../platform/files/invoice-exporter';
import { DRIZZLE } from '../../platform/database/database.module';
import {
  parties,
  salesInvoiceItems,
  salesInvoices,
  salesInvoiceVersions,
} from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { SalesInvoiceNotFoundError } from './sales-invoices.errors';
import type { Database } from '../../platform/database/connect';
import type {
  ExportedFile,
  InvoiceExporter,
  InvoiceSnapshotValue,
} from '../../platform/files/invoice-exporter';
import type { SalesInvoiceSnapshotValue } from '../../platform/database/schema';

function snapshotInteger(value: SalesInvoiceSnapshotValue, key: string): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as Readonly<Record<string, SalesInvoiceSnapshotValue>>)[key];
  return typeof candidate === 'string' && /^\d+$/u.test(candidate) ? candidate : null;
}

/** Generates a sales receipt from the current immutable invoice version. */
@Injectable()
export class SalesInvoicePdfService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(DocumentIssuerService) private readonly issuer: DocumentIssuerService,
    @Inject(INVOICE_EXPORTER) private readonly exporter: InvoiceExporter,
  ) {}

  async export(tenantId: string, invoiceId: string): Promise<ExportedFile> {
    const document = await withTenantTransaction(this.db, tenantId, async (transaction) => {
      const [invoice] = await transaction
        .select()
        .from(salesInvoices)
        .where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, invoiceId)))
        .limit(1);
      if (
        invoice === undefined ||
        invoice.status !== 'FINALIZED' ||
        invoice.invoiceNumber === null ||
        invoice.quoteAmountRial === null ||
        invoice.quoteObservedAt === null ||
        invoice.finalizedAt === null
      ) {
        throw new SalesInvoiceNotFoundError(invoiceId);
      }

      const [version] = await transaction
        .select()
        .from(salesInvoiceVersions)
        .where(
          and(
            eq(salesInvoiceVersions.tenantId, tenantId),
            eq(salesInvoiceVersions.salesInvoiceId, invoiceId),
            eq(salesInvoiceVersions.version, invoice.currentVersion),
          ),
        )
        .limit(1);
      if (version === undefined) throw new SalesInvoiceNotFoundError(invoiceId);

      const [party] = await transaction
        .select({ displayName: parties.displayName, mobile: parties.mobile })
        .from(parties)
        .where(and(eq(parties.tenantId, tenantId), eq(parties.id, version.partyId)))
        .limit(1);
      if (party === undefined) throw new SalesInvoiceNotFoundError(invoiceId);

      const items = await transaction
        .select()
        .from(salesInvoiceItems)
        .where(
          and(
            eq(salesInvoiceItems.tenantId, tenantId),
            eq(salesInvoiceItems.salesInvoiceId, invoiceId),
            eq(salesInvoiceItems.salesInvoiceVersionId, version.id),
          ),
        );

      return { invoice, items, party, version };
    });
    const issuer = await this.issuer.getIssuer(tenantId);
    const invoiceNumber = document.invoice.invoiceNumber;
    const quoteAmountRial = document.invoice.quoteAmountRial;
    const quoteObservedAt = document.invoice.quoteObservedAt;
    const finalizedAt = document.invoice.finalizedAt;
    if (
      invoiceNumber === null ||
      quoteAmountRial === null ||
      quoteObservedAt === null ||
      finalizedAt === null
    ) {
      throw new SalesInvoiceNotFoundError(invoiceId);
    }

    return this.exporter.exportInvoice({
      title: 'رسید فروش',
      documentNumber: invoiceNumber.toString(),
      issuedAt: finalizedAt,
      issuer,
      recipient: document.party,
      lockedQuote: {
        amountRial: quoteAmountRial.toString(),
        observedAt: quoteObservedAt,
      },
      lines: document.items.map((item) => ({
        title: item.itemType === 'COIN' ? 'سکه' : 'زیورآلات',
        quantity: item.quantity.toString(),
        amountRial: snapshotInteger(item.lineSnapshot, 'payableRial'),
      })),
      historicalSnapshot: {
        version: document.version.version.toString(),
        totals: document.version.totalsSnapshot as InvoiceSnapshotValue,
        settings: document.version.settingsSnapshot as InvoiceSnapshotValue,
        lines: document.items.map((item) => item.lineSnapshot as InvoiceSnapshotValue),
      },
    });
  }
}
