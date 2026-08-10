import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../../platform/audit/audit.service';
import { DRIZZLE } from '../../platform/database/database.module';
import {
  salesInvoiceItems,
  salesInvoiceVersions,
  salesInvoices,
  priceQuotes,
} from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { PartiesService, PartyNotFoundError } from '../parties/parties.service';
import { DocumentCountersService, jalaliYearPeriodKey } from './document-counters.service';
import {
  SalesInvoiceNotDraftError,
  SalesInvoiceNotFoundError,
  SalesInvoiceQuoteNotFoundError,
  SalesInvoiceRequiresItemsError,
  InvalidSalesInvoiceFinalizeInputError,
} from './sales-invoices.errors';
import type { Database } from '../../platform/database/connect';
import type {
  SalesInvoice,
  SalesInvoiceItem,
  SalesInvoiceItemType,
  SalesInvoiceSnapshotValue,
  SalesInvoiceVersion,
} from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

export interface CreateDraftSalesInvoiceInput {
  readonly tenantId: string;
  readonly partyId: string;
  readonly createdBy: string;
}

export interface FinalizeSalesInvoiceItemInput {
  readonly itemType: SalesInvoiceItemType;
  readonly itemId: string;
  readonly quantity: number;
  readonly lineSnapshot: SalesInvoiceSnapshotValue;
}

export interface FinalizeSalesInvoiceInput {
  readonly tenantId: string;
  readonly salesInvoiceId: string;
  readonly effectiveAt: Date;
  readonly quoteId: string;
  readonly quoteAmountRial: bigint;
  readonly quoteObservedAt: Date;
  readonly totalsSnapshot: SalesInvoiceSnapshotValue;
  readonly settingsSnapshot: SalesInvoiceSnapshotValue;
  readonly items: readonly FinalizeSalesInvoiceItemInput[];
  readonly createdBy: string;
}

export interface FinalizedSalesInvoice {
  readonly invoice: SalesInvoice;
  readonly version: SalesInvoiceVersion;
  readonly items: readonly SalesInvoiceItem[];
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function isSnapshotValue(
  value: unknown,
  seen = new WeakSet<object>(),
): value is SalesInvoiceSnapshotValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true;
  }
  if (typeof value !== 'object' || value === undefined || seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.every((item) => isSnapshotValue(item, seen));
  }
  return isPlainRecord(value) && Object.values(value).every((item) => isSnapshotValue(item, seen));
}

function assertFinalizeInput(input: FinalizeSalesInvoiceInput): void {
  if (!isSnapshotValue(input.totalsSnapshot) || !isSnapshotValue(input.settingsSnapshot)) {
    throw new InvalidSalesInvoiceFinalizeInputError(
      'Invoice snapshots must not contain number values',
    );
  }
  for (const item of input.items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new InvalidSalesInvoiceFinalizeInputError(
        'Invoice item quantity must be a positive integer',
      );
    }
    if (!isSnapshotValue(item.lineSnapshot)) {
      throw new InvalidSalesInvoiceFinalizeInputError(
        'Invoice line snapshots must not contain number values',
      );
    }
  }
}

/**
 * مدل و چرخه‌ی عمر فاکتور فروش نسخه‌دار — BE-039.
 *
 * این سرویس موتور قیمت‌گذاری نیست (BE-040) و مسیر posting دفتر کل و
 * موجودی هم نمی‌سازد (BE-041) — فقط مدل و دو حرکت چرخه‌ی عمر: ساخت
 * پیش‌نویس و finalize کردنِ آن به نسخه‌ی ۱. مقادیرِ مظنه، totals و
 * settings را فراخوان (در نهایت BE-040/041) حساب و پاس می‌دهد؛ اینجا
 * فقط ذخیره و قفل می‌شود.
 */
@Injectable()
export class SalesInvoicesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PartiesService) private readonly parties: PartiesService,
    @Inject(DocumentCountersService) private readonly counters: DocumentCountersService,
  ) {}

  async createDraft(input: CreateDraftSalesInvoiceInput): Promise<SalesInvoice> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.createDraftInTransaction(transaction, input),
    );
  }

  /** Party غیرفعال قابل انتخاب برای فاکتور تازه نیست — همان قاعده‌ی BE-024. */
  async createDraftInTransaction(
    transaction: TenantTransaction,
    input: CreateDraftSalesInvoiceInput,
  ): Promise<SalesInvoice> {
    const party = await this.parties.findActiveInTransaction(
      transaction,
      input.tenantId,
      input.partyId,
    );
    if (party === undefined) {
      throw new PartyNotFoundError();
    }

    const [created] = await transaction
      .insert(salesInvoices)
      .values({
        tenantId: input.tenantId,
        partyId: input.partyId,
        createdBy: input.createdBy,
      })
      .returning();
    const invoice = created!;

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: input.createdBy,
      action: 'SALES_INVOICE_DRAFT_CREATED',
      entityType: 'sales_invoice',
      entityId: invoice.id,
      afterData: { partyId: input.partyId, status: invoice.status },
    });

    return invoice;
  }

  async finalize(input: FinalizeSalesInvoiceInput): Promise<FinalizedSalesInvoice> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.finalizeInTransaction(transaction, input),
    );
  }

  /**
   * پیش‌نویس را نسخه‌ی ۱ می‌کند: شماره‌ی بدون شکاف مصرف می‌شود
   * (BE-038)، مظنه روی سربرگ قفل می‌شود، و نسخه + ردیف‌های آن با
   * totals/settings snapshot ثبت می‌شوند — همه در همان تراکنش، پس
   * rollback فراخوان همه‌چیز از جمله شماره‌ی مصرف‌شده را برمی‌گرداند.
   *
   * این متد فقط روی فاکتورِ `DRAFT` کار می‌کند و همیشه دقیقاً نسخه‌ی ۱
   * می‌سازد — بعد از موفقیت status به `FINALIZED` می‌رود و همین متد
   * دیگر روی همان فاکتور اجرا نمی‌شود. اصلاح (نسخه‌ی ۲ به بعد) کار
   * جداگانه‌ی BE-054 است؛ این عمداً «نسخه‌ی بعدی» را حساب نمی‌کند.
   */
  async finalizeInTransaction(
    transaction: TenantTransaction,
    input: FinalizeSalesInvoiceInput,
  ): Promise<FinalizedSalesInvoice> {
    assertFinalizeInput(input);
    if (input.items.length === 0) {
      throw new SalesInvoiceRequiresItemsError();
    }

    const [invoice] = await transaction
      .select()
      .from(salesInvoices)
      .where(
        and(eq(salesInvoices.tenantId, input.tenantId), eq(salesInvoices.id, input.salesInvoiceId)),
      )
      .limit(1);
    if (invoice === undefined) {
      throw new SalesInvoiceNotFoundError(input.salesInvoiceId);
    }
    if (invoice.status !== 'DRAFT') {
      throw new SalesInvoiceNotDraftError(input.salesInvoiceId);
    }

    const [quote] = await transaction
      .select()
      .from(priceQuotes)
      .where(and(eq(priceQuotes.tenantId, input.tenantId), eq(priceQuotes.id, input.quoteId)))
      .limit(1);
    if (
      quote === undefined ||
      quote.amountRial !== input.quoteAmountRial ||
      quote.observedAt.getTime() !== input.quoteObservedAt.getTime()
    ) {
      throw new SalesInvoiceQuoteNotFoundError();
    }

    const invoiceNumber = await this.counters.getNextNumberInTransaction(transaction, {
      tenantId: input.tenantId,
      documentType: 'SALES_INVOICE',
      periodKey: jalaliYearPeriodKey(input.effectiveAt),
    });

    const [updatedInvoice] = await transaction
      .update(salesInvoices)
      .set({
        invoiceNumber,
        currentVersion: 1,
        status: 'FINALIZED',
        quoteId: input.quoteId,
        quoteAmountRial: input.quoteAmountRial,
        quoteObservedAt: input.quoteObservedAt,
        finalizedAt: input.effectiveAt,
      })
      .where(eq(salesInvoices.id, invoice.id))
      .returning();

    const [createdVersion] = await transaction
      .insert(salesInvoiceVersions)
      .values({
        tenantId: input.tenantId,
        salesInvoiceId: invoice.id,
        version: 1,
        reason: null,
        totalsSnapshot: input.totalsSnapshot,
        settingsSnapshot: input.settingsSnapshot,
        createdBy: input.createdBy,
      })
      .returning();
    const version = createdVersion!;

    const createdItems = await transaction
      .insert(salesInvoiceItems)
      .values(
        input.items.map((item) => ({
          tenantId: input.tenantId,
          salesInvoiceId: invoice.id,
          salesInvoiceVersionId: version.id,
          itemType: item.itemType,
          itemId: item.itemId,
          quantity: item.quantity,
          lineSnapshot: item.lineSnapshot,
        })),
      )
      .returning();

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: input.createdBy,
      action: 'SALES_INVOICE_FINALIZED',
      entityType: 'sales_invoice',
      entityId: invoice.id,
      afterData: {
        invoiceNumber: invoiceNumber.toString(),
        version: '1',
        itemCount: createdItems.length.toString(),
      },
    });

    return { invoice: updatedInvoice!, version, items: createdItems };
  }
}
