import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt } from 'drizzle-orm';
import { AuditService } from '../../platform/audit/audit.service';
import { DRIZZLE } from '../../platform/database/database.module';
import {
  salesInvoiceItems,
  salesInvoiceVersions,
  salesInvoices,
  settlements,
} from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { AssetDimensionsService } from '../ledger/asset-dimensions.service';
import { LedgerAccountsService } from '../ledger/ledger-accounts.service';
import { LedgerPostingService } from '../ledger/ledger-posting.service';
import type { LedgerPostingEntryInput } from '../ledger/ledger-posting.service';
import { InventoryMovementsService } from '../inventory/inventory-movements.service';
import { PartiesService, PartyNotFoundError } from '../parties/parties.service';
import { InvoiceAmendmentPolicyService } from './invoice-amendment-policy.service';
import { SalesInvoiceNotFoundError } from './sales-invoices.errors';
import { SalesPricingService } from './sales-pricing.service';
import {
  SalesInvoiceAmendmentNotFinalizedError,
  SalesInvoiceAmendmentPaidRialExceedsPayableError,
  SalesInvoiceAmendmentSnapshotInvalidError,
  SalesInvoiceAmendmentUnsupportedItemsError,
} from './invoice-amendments.errors';
import type { AmendSalesInvoiceInput } from '@gold/contracts';
import type { Database } from '../../platform/database/connect';
import type {
  InventoryItemType,
  RoleCode,
  SalesInvoiceItem,
  SalesInvoiceSnapshotValue,
  SalesInvoiceVersion,
} from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

interface AmendSalesInvoiceCommand {
  readonly tenantId: string;
  readonly salesInvoiceId: string;
  readonly input: AmendSalesInvoiceInput;
  readonly actorUserId: string;
  readonly actorRole: RoleCode;
  /** Server-controlled amendment time; never supplied by the client. */
  readonly amendedAt: Date;
}

export interface AmendedSalesInvoiceResult {
  readonly invoiceId: string;
  readonly invoiceNumber: number;
  readonly version: number;
  readonly payableRial: bigint;
  readonly receivableRial: bigint;
  readonly ledgerTransactionId: string;
  readonly inventoryMovementIds: readonly string[];
}

interface InventoryAsset {
  readonly itemType: 'JEWELRY' | 'COIN';
  readonly itemId: string;
  /** Jewelry uses pure mg; coin uses its independent count. */
  readonly ledgerQuantity: bigint;
  /** Inventory records jewelry and coin in their own count units. */
  readonly inventoryQuantity: bigint;
}

interface CalculatedAmendment {
  readonly item: {
    readonly itemType: 'JEWELRY' | 'COIN';
    readonly itemId: string;
    readonly quantity: number;
    readonly lineSnapshot: SalesInvoiceSnapshotValue;
  };
  readonly totalsSnapshot: SalesInvoiceSnapshotValue;
  readonly settingsSnapshot: SalesInvoiceSnapshotValue;
  readonly payableRial: bigint;
  readonly paidRial: bigint;
  readonly receivableRial: bigint;
  readonly asset: InventoryAsset;
}

function isSnapshotRecord(
  value: SalesInvoiceSnapshotValue,
): value is { readonly [key: string]: SalesInvoiceSnapshotValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredNonNegativeSnapshotInteger(
  snapshot: SalesInvoiceSnapshotValue,
  key: string,
): bigint {
  if (
    !isSnapshotRecord(snapshot) ||
    typeof snapshot[key] !== 'string' ||
    !/^\d+$/u.test(snapshot[key])
  ) {
    throw new SalesInvoiceAmendmentSnapshotInvalidError(
      `Current invoice snapshot is missing a valid ${key}`,
    );
  }

  return BigInt(snapshot[key]);
}

function optionalNonNegativeSnapshotInteger(
  snapshot: SalesInvoiceSnapshotValue,
  key: string,
): bigint | undefined {
  if (!isSnapshotRecord(snapshot) || snapshot[key] === undefined) {
    return undefined;
  }
  if (typeof snapshot[key] !== 'string' || !/^\d+$/u.test(snapshot[key])) {
    throw new SalesInvoiceAmendmentSnapshotInvalidError(
      `Current invoice snapshot has an invalid ${key}`,
    );
  }

  return BigInt(snapshot[key]);
}

function invoiceAsset(item: SalesInvoiceItem): InventoryAsset {
  if (item.itemType === 'JEWELRY') {
    return {
      itemType: 'JEWELRY',
      itemId: item.itemId,
      ledgerQuantity: requiredNonNegativeSnapshotInteger(item.lineSnapshot, 'pureWeightMg'),
      inventoryQuantity: BigInt(item.quantity),
    };
  }

  return {
    itemType: 'COIN',
    itemId: item.itemId,
    ledgerQuantity: BigInt(item.quantity),
    inventoryQuantity: BigInt(item.quantity),
  };
}

function absoluteDifference(left: bigint, right: bigint): bigint {
  return left >= right ? left - right : right - left;
}

function addEntry(
  entries: Map<string, LedgerPostingEntryInput>,
  entry: LedgerPostingEntryInput,
): void {
  const key = `${entry.accountId}:${entry.dimensionId}`;
  const current = entries.get(key);
  const quantity = (current?.quantity ?? 0n) + entry.quantity;

  if (quantity === 0n) {
    entries.delete(key);
    return;
  }

  entries.set(key, { ...entry, quantity });
}

function addInventoryQuantity(
  quantities: Map<string, { itemType: InventoryItemType; itemId: string; quantity: bigint }>,
  itemType: InventoryItemType,
  itemId: string,
  quantity: bigint,
): void {
  const key = `${itemType}:${itemId}`;
  const current = quantities.get(key);
  const nextQuantity = (current?.quantity ?? 0n) + quantity;

  if (nextQuantity === 0n) {
    quantities.delete(key);
    return;
  }

  quantities.set(key, { itemType, itemId, quantity: nextQuantity });
}

/**
 * Creates the next immutable invoice version and posts only its difference.
 * The original invoice number, versions, ledger transaction, and inventory
 * movement remain untouched.
 */
@Injectable()
export class InvoiceAmendmentsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AssetDimensionsService) private readonly dimensions: AssetDimensionsService,
    @Inject(InventoryMovementsService) private readonly movements: InventoryMovementsService,
    @Inject(InvoiceAmendmentPolicyService) private readonly policy: InvoiceAmendmentPolicyService,
    @Inject(LedgerAccountsService) private readonly accounts: LedgerAccountsService,
    @Inject(LedgerPostingService) private readonly ledger: LedgerPostingService,
    @Inject(PartiesService) private readonly parties: PartiesService,
    @Inject(SalesPricingService) private readonly pricing: SalesPricingService,
  ) {}

  async amend(command: AmendSalesInvoiceCommand): Promise<AmendedSalesInvoiceResult> {
    return withTenantTransaction(this.db, command.tenantId, (transaction) =>
      this.amendInTransaction(transaction, command),
    );
  }

  async amendInTransaction(
    transaction: TenantTransaction,
    command: AmendSalesInvoiceCommand,
  ): Promise<AmendedSalesInvoiceResult> {
    const [invoice] = await transaction
      .select()
      .from(salesInvoices)
      .where(
        and(
          eq(salesInvoices.tenantId, command.tenantId),
          eq(salesInvoices.id, command.salesInvoiceId),
        ),
      )
      .limit(1)
      .for('update');
    if (invoice === undefined) {
      throw new SalesInvoiceNotFoundError(command.salesInvoiceId);
    }
    if (
      invoice.status !== 'FINALIZED' ||
      invoice.invoiceNumber === null ||
      invoice.quoteId === null ||
      invoice.finalizedAt === null
    ) {
      throw new SalesInvoiceAmendmentNotFinalizedError();
    }

    const [currentVersion] = await transaction
      .select()
      .from(salesInvoiceVersions)
      .where(
        and(
          eq(salesInvoiceVersions.tenantId, command.tenantId),
          eq(salesInvoiceVersions.salesInvoiceId, invoice.id),
          eq(salesInvoiceVersions.version, invoice.currentVersion),
        ),
      )
      .limit(1);
    if (currentVersion === undefined) {
      throw new SalesInvoiceAmendmentSnapshotInvalidError('Current invoice version is missing');
    }

    const currentItems = await transaction
      .select()
      .from(salesInvoiceItems)
      .where(
        and(
          eq(salesInvoiceItems.tenantId, command.tenantId),
          eq(salesInvoiceItems.salesInvoiceVersionId, currentVersion.id),
        ),
      );
    if (currentItems.length !== 1) {
      throw new SalesInvoiceAmendmentUnsupportedItemsError();
    }
    const currentItem = currentItems[0]!;
    const currentAsset = invoiceAsset(currentItem);
    const currentPayableRial = requiredNonNegativeSnapshotInteger(
      currentVersion.totalsSnapshot,
      'payableRial',
    );
    const currentPaidRial =
      optionalNonNegativeSnapshotInteger(currentVersion.totalsSnapshot, 'paidRial') ??
      currentPayableRial;
    if (currentPaidRial > currentPayableRial) {
      throw new SalesInvoiceAmendmentSnapshotInvalidError(
        'Current invoice paid Rial exceeds its payable Rial',
      );
    }
    const currentReceivableRial = currentPayableRial - currentPaidRial;

    const replacementParty = await this.parties.findActiveInTransaction(
      transaction,
      command.tenantId,
      command.input.partyId,
    );
    if (replacementParty === undefined) {
      throw new PartyNotFoundError();
    }
    const calculated = await this.calculateReplacement(
      transaction,
      command,
      invoice.quoteId,
      invoice.finalizedAt,
    );
    const [settlement] = await transaction
      .select({ id: settlements.id })
      .from(settlements)
      .where(
        and(
          eq(settlements.tenantId, command.tenantId),
          eq(settlements.partyId, currentVersion.partyId),
          eq(settlements.status, 'FINALIZED'),
          gt(settlements.finalizedAt, invoice.finalizedAt),
        ),
      )
      .limit(1);

    await this.policy.assertPermittedInTransaction(transaction, {
      tenantId: command.tenantId,
      actorRole: command.actorRole,
      finalizedAt: invoice.finalizedAt,
      requestedAt: command.amendedAt,
      reason: command.input.reason,
      ...(command.input.reasonDetail === undefined
        ? {}
        : { reasonDetail: command.input.reasonDetail }),
      // A day-closing module has not been introduced yet, so no close event exists to resolve.
      businessDayClosed: false,
      // Settlements are party-level; any later finalized settlement is conservatively restricted.
      isSettled: settlement !== undefined,
      varianceRial: absoluteDifference(calculated.payableRial, currentPayableRial),
    });

    const nextVersionNumber = invoice.currentVersion + 1;
    const [createdVersion] = await transaction
      .insert(salesInvoiceVersions)
      .values({
        tenantId: command.tenantId,
        salesInvoiceId: invoice.id,
        version: nextVersionNumber,
        reason: command.input.reason,
        reasonDetail: command.input.reasonDetail ?? null,
        partyId: command.input.partyId,
        totalsSnapshot: calculated.totalsSnapshot,
        settingsSnapshot: calculated.settingsSnapshot,
        createdBy: command.actorUserId,
      })
      .returning();
    const version = createdVersion!;

    await transaction.insert(salesInvoiceItems).values({
      tenantId: command.tenantId,
      salesInvoiceId: invoice.id,
      salesInvoiceVersionId: version.id,
      itemType: calculated.item.itemType,
      itemId: calculated.item.itemId,
      quantity: calculated.item.quantity,
      lineSnapshot: calculated.item.lineSnapshot,
    });

    const [updatedInvoice] = await transaction
      .update(salesInvoices)
      .set({ currentVersion: nextVersionNumber, partyId: command.input.partyId })
      .where(eq(salesInvoices.id, invoice.id))
      .returning({ id: salesInvoices.id });
    if (updatedInvoice === undefined) {
      throw new Error('Sales invoice was not updated to its new version');
    }

    const inventoryMovementIds = await this.postInventoryDifference(
      transaction,
      command,
      version.id,
      currentAsset,
      calculated.asset,
    );
    const ledgerTransactionId = await this.postLedgerDifference(
      transaction,
      command,
      invoice.invoiceNumber,
      version.id,
      currentVersion,
      currentPayableRial,
      currentPaidRial,
      currentReceivableRial,
      currentAsset,
      calculated,
    );

    await this.audit.recordInTransaction(transaction, {
      tenantId: command.tenantId,
      actorUserId: command.actorUserId,
      action: 'SALES_INVOICE_AMENDED',
      entityType: 'sales_invoice',
      entityId: invoice.id,
      beforeData: {
        version: currentVersion.version.toString(),
        partyId: currentVersion.partyId,
        payableRial: currentPayableRial.toString(),
      },
      afterData: {
        version: version.version.toString(),
        partyId: version.partyId,
        payableRial: calculated.payableRial.toString(),
        reason: version.reason,
        ledgerTransactionId,
        inventoryMovementIds,
      },
    });

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      version: version.version,
      payableRial: calculated.payableRial,
      receivableRial: calculated.receivableRial,
      ledgerTransactionId,
      inventoryMovementIds,
    };
  }

  private async calculateReplacement(
    transaction: TenantTransaction,
    command: AmendSalesInvoiceCommand,
    quoteId: string,
    originalEffectiveAt: Date,
  ): Promise<CalculatedAmendment> {
    const { item } = command.input;

    if (item.itemType === 'JEWELRY') {
      const price = await this.pricing.priceJewelryInTransaction(transaction, {
        tenantId: command.tenantId,
        jewelryItemId: item.jewelryItemId,
        quoteId,
        effectiveAt: originalEffectiveAt,
      });
      const payableRial = BigInt(price.payableRial);
      const paidRial = BigInt(item.paidRial);
      if (paidRial > payableRial) {
        throw new SalesInvoiceAmendmentPaidRialExceedsPayableError();
      }
      const receivableRial = payableRial - paidRial;

      return {
        item: {
          itemType: 'JEWELRY',
          itemId: item.jewelryItemId,
          quantity: 1,
          lineSnapshot: {
            jewelryItemVersionId: price.jewelryItemVersionId,
            pureWeightMg: price.pureWeightMg,
            payableRial: price.payableRial,
            goldValueRial: price.goldValueRial,
            wageRial: price.wageRial,
            profitRial: price.profitRial,
            taxRial: price.taxRial,
          },
        },
        totalsSnapshot: {
          saleKind: 'JEWELRY',
          payableRial: price.payableRial,
          paidRial: paidRial.toString(),
          receivableRial: receivableRial.toString(),
          payableBeforeRoundingRial: price.payableBeforeRoundingRial,
          goldValueRial: price.goldValueRial,
          wageRial: price.wageRial,
          profitRial: price.profitRial,
          taxRial: price.taxRial,
          pureWeightMg: price.pureWeightMg,
        },
        settingsSnapshot: price.settingsSnapshot,
        payableRial,
        paidRial,
        receivableRial,
        asset: {
          itemType: 'JEWELRY',
          itemId: item.jewelryItemId,
          ledgerQuantity: BigInt(price.pureWeightMg),
          inventoryQuantity: 1n,
        },
      };
    }

    const price = await this.pricing.priceCoinInTransaction(transaction, {
      tenantId: command.tenantId,
      coinTypeId: item.coinTypeId,
      count: item.count,
      marketUnitPriceRial: BigInt(item.marketUnitPriceRial),
      quoteId,
      effectiveAt: originalEffectiveAt,
    });
    const payableRial = BigInt(price.payableRial);
    const paidRial = BigInt(item.paidRial);
    if (paidRial > payableRial) {
      throw new SalesInvoiceAmendmentPaidRialExceedsPayableError();
    }
    const receivableRial = payableRial - paidRial;

    return {
      item: {
        itemType: 'COIN',
        itemId: item.coinTypeId,
        quantity: price.count,
        lineSnapshot: {
          coinTypeVersionId: price.coinTypeVersionId,
          count: price.count.toString(),
          marketUnitPriceRial: price.marketUnitPriceRial,
          goldRate1000Rial: price.goldRate1000Rial,
          intrinsicValueRial: price.intrinsicValueRial,
          bubbleRial: price.bubbleRial,
          payableRial: price.payableRial,
        },
      },
      totalsSnapshot: {
        saleKind: 'COIN',
        payableRial: price.payableRial,
        paidRial: paidRial.toString(),
        receivableRial: receivableRial.toString(),
        count: price.count.toString(),
        marketUnitPriceRial: price.marketUnitPriceRial,
        intrinsicValueRial: price.intrinsicValueRial,
        bubbleRial: price.bubbleRial,
      },
      settingsSnapshot: price.settingsSnapshot,
      payableRial,
      paidRial,
      receivableRial,
      asset: {
        itemType: 'COIN',
        itemId: item.coinTypeId,
        ledgerQuantity: BigInt(price.count),
        inventoryQuantity: BigInt(price.count),
      },
    };
  }

  private async postInventoryDifference(
    transaction: TenantTransaction,
    command: AmendSalesInvoiceCommand,
    versionId: string,
    current: InventoryAsset,
    replacement: InventoryAsset,
  ): Promise<readonly string[]> {
    const quantities = new Map<
      string,
      { itemType: InventoryItemType; itemId: string; quantity: bigint }
    >();
    addInventoryQuantity(quantities, current.itemType, current.itemId, current.inventoryQuantity);
    addInventoryQuantity(
      quantities,
      replacement.itemType,
      replacement.itemId,
      -replacement.inventoryQuantity,
    );
    const movements = await this.movements.recordManyInTransaction(
      transaction,
      command.tenantId,
      [...quantities.values()].map((movement) => ({
        sourceType: 'CORRECTION' as const,
        sourceId: versionId,
        itemType: movement.itemType,
        itemId: movement.itemId,
        quantity: movement.quantity,
        occurredAt: command.amendedAt,
      })),
    );

    return movements.map((movement) => movement.id);
  }

  private async postLedgerDifference(
    transaction: TenantTransaction,
    command: AmendSalesInvoiceCommand,
    invoiceNumber: number,
    versionId: string,
    currentVersion: SalesInvoiceVersion,
    currentPayableRial: bigint,
    currentPaidRial: bigint,
    currentReceivableRial: bigint,
    currentAsset: InventoryAsset,
    replacement: CalculatedAmendment,
  ): Promise<string> {
    const [
      cash,
      salesRevenue,
      cogsJewelry,
      inventoryJewelry,
      rial,
      currentParty,
      replacementParty,
    ] = await Promise.all([
      this.accounts.getRequiredSystemAccountInTransaction(transaction, command.tenantId, 'CASH'),
      this.accounts.getRequiredSystemAccountInTransaction(
        transaction,
        command.tenantId,
        'SALES_REVENUE',
      ),
      this.accounts.getRequiredSystemAccountInTransaction(
        transaction,
        command.tenantId,
        'COGS_JEWELRY',
      ),
      this.accounts.getRequiredSystemAccountInTransaction(
        transaction,
        command.tenantId,
        'INVENTORY_JEWELRY',
      ),
      this.dimensions.getRequiredBaseDimensionInTransaction(transaction, command.tenantId, 'RIAL'),
      this.accounts.ensurePartyAccountsInTransaction(transaction, {
        tenantId: command.tenantId,
        partyId: currentVersion.partyId,
      }),
      this.accounts.ensurePartyAccountsInTransaction(transaction, {
        tenantId: command.tenantId,
        partyId: command.input.partyId,
      }),
    ]);
    const entries = new Map<string, LedgerPostingEntryInput>();
    const addRialDifference = (accountId: string, quantity: bigint) => {
      if (quantity !== 0n) {
        addEntry(entries, { accountId, dimensionId: rial.id, quantity });
      }
    };

    addRialDifference(cash.id, -currentPaidRial);
    addRialDifference(currentParty.receivable.id, -currentReceivableRial);
    addRialDifference(salesRevenue.id, currentPayableRial);
    addRialDifference(cash.id, replacement.paidRial);
    addRialDifference(replacementParty.receivable.id, replacement.receivableRial);
    addRialDifference(salesRevenue.id, -replacement.payableRial);

    await this.addAssetDifferenceEntries(
      transaction,
      command.tenantId,
      entries,
      currentAsset,
      -currentAsset.ledgerQuantity,
      cogsJewelry.id,
      inventoryJewelry.id,
    );
    await this.addAssetDifferenceEntries(
      transaction,
      command.tenantId,
      entries,
      replacement.asset,
      replacement.asset.ledgerQuantity,
      cogsJewelry.id,
      inventoryJewelry.id,
    );

    const posted = await this.ledger.postInTransaction(transaction, {
      source: { tenantId: command.tenantId, type: 'SALES_INVOICE_AMENDMENT', id: versionId },
      effectiveAt: command.amendedAt,
      description: `Sales invoice amendment ${invoiceNumber}`,
      createdBy: command.actorUserId,
      entries: [...entries.values()],
    });

    return posted.transaction.id;
  }

  private async addAssetDifferenceEntries(
    transaction: TenantTransaction,
    tenantId: string,
    entries: Map<string, LedgerPostingEntryInput>,
    asset: InventoryAsset,
    quantity: bigint,
    cogsJewelryAccountId: string,
    inventoryJewelryAccountId: string,
  ): Promise<void> {
    if (quantity === 0n) {
      return;
    }
    const dimension = await this.dimensions.resolveInventoryDimensionInTransaction(
      transaction,
      tenantId,
      asset.itemType,
      asset.itemId,
    );
    const [cogsAccountId, inventoryAccountId] =
      asset.itemType === 'JEWELRY'
        ? [cogsJewelryAccountId, inventoryJewelryAccountId]
        : [
            (
              await this.accounts.getRequiredSystemAccountInTransaction(
                transaction,
                tenantId,
                'COGS_COIN',
              )
            ).id,
            (
              await this.accounts.getRequiredSystemAccountInTransaction(
                transaction,
                tenantId,
                `INVENTORY_COIN:${asset.itemId}`,
              )
            ).id,
          ];

    addEntry(entries, { accountId: cogsAccountId, dimensionId: dimension.id, quantity });
    addEntry(entries, {
      accountId: inventoryAccountId,
      dimensionId: dimension.id,
      quantity: -quantity,
    });
  }
}
