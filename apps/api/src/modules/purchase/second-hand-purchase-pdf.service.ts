import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DocumentIssuerService } from '../../platform/files/document-issuer.service';
import { INVOICE_EXPORTER } from '../../platform/files/invoice-exporter';
import { DRIZZLE } from '../../platform/database/database.module';
import {
  parties,
  secondHandPurchaseItems,
  secondHandPurchases,
} from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { SecondHandPurchaseNotFoundError } from './second-hand-gold-purchases.errors';
import type { Database } from '../../platform/database/connect';
import type {
  ExportedFile,
  InvoiceExporter,
  InvoiceSnapshotValue,
} from '../../platform/files/invoice-exporter';
import type { SecondHandPurchaseSnapshotValue } from '../../platform/database/schema';

function snapshotRecord(
  value: SecondHandPurchaseSnapshotValue,
): Readonly<Record<string, SecondHandPurchaseSnapshotValue>> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Readonly<Record<string, SecondHandPurchaseSnapshotValue>>;
}

function snapshotString(value: SecondHandPurchaseSnapshotValue, key: string): string | null {
  const candidate = snapshotRecord(value)?.[key];
  return typeof candidate === 'string' ? candidate : null;
}

function snapshotMoney(value: SecondHandPurchaseSnapshotValue): string | null {
  for (const key of ['finalAmountRial', 'purchaseAmountRial', 'grossPurchaseAmountRial']) {
    const candidate = snapshotString(value, key);
    if (candidate !== null && /^\d+$/u.test(candidate)) return candidate;
  }
  return null;
}

/** Generates a purchase receipt strictly from its locked source document and snapshots. */
@Injectable()
export class SecondHandPurchasePdfService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(DocumentIssuerService) private readonly issuer: DocumentIssuerService,
    @Inject(INVOICE_EXPORTER) private readonly exporter: InvoiceExporter,
  ) {}

  async export(tenantId: string, purchaseId: string): Promise<ExportedFile> {
    const document = await withTenantTransaction(this.db, tenantId, async (transaction) => {
      const [purchase] = await transaction
        .select()
        .from(secondHandPurchases)
        .where(and(eq(secondHandPurchases.tenantId, tenantId), eq(secondHandPurchases.id, purchaseId)))
        .limit(1);
      if (purchase === undefined) throw new SecondHandPurchaseNotFoundError(purchaseId);

      const [party] = await transaction
        .select({ displayName: parties.displayName, mobile: parties.mobile })
        .from(parties)
        .where(and(eq(parties.tenantId, tenantId), eq(parties.id, purchase.partyId)))
        .limit(1);
      if (party === undefined) throw new SecondHandPurchaseNotFoundError(purchaseId);

      const items = await transaction
        .select()
        .from(secondHandPurchaseItems)
        .where(
          and(
            eq(secondHandPurchaseItems.tenantId, tenantId),
            eq(secondHandPurchaseItems.secondHandPurchaseId, purchaseId),
          ),
        );

      return { items, party, purchase };
    });
    const issuer = await this.issuer.getIssuer(tenantId);
    const sellerName = snapshotString(document.purchase.sellerIdentitySnapshot, 'displayName');
    const sellerMobile = snapshotString(document.purchase.sellerIdentitySnapshot, 'mobile');

    return this.exporter.exportInvoice({
      title: 'رسید خرید دست‌دوم',
      documentNumber: document.purchase.id,
      issuedAt: document.purchase.effectiveAt,
      issuer,
      recipient: {
        displayName: sellerName ?? document.party.displayName,
        mobile: sellerMobile ?? document.party.mobile,
      },
      lockedQuote: {
        amountRial: document.purchase.lockedQuoteAmountRial.toString(),
        observedAt: document.purchase.lockedQuoteObservedAt,
      },
      lines: document.items.map((item) => ({
        title: item.itemType === 'COIN' ? 'سکه دست‌دوم' : 'طلای دست‌دوم (میلی‌گرم خالص)',
        quantity:
          item.itemType === 'COIN'
            ? item.coinCount!.toString()
            : item.pureWeightMg!.toString(),
        amountRial: snapshotMoney(item.itemSnapshot) ?? document.purchase.finalAmountRial.toString(),
      })),
      historicalSnapshot: {
        settings: document.purchase.settingsSnapshot as InvoiceSnapshotValue,
        seller: document.purchase.sellerIdentitySnapshot as InvoiceSnapshotValue,
        feeRial: document.purchase.feeRial.toString(),
        finalAmountRial: document.purchase.finalAmountRial.toString(),
        lines: document.items.map((item) => item.itemSnapshot as InvoiceSnapshotValue),
      },
    });
  }
}
