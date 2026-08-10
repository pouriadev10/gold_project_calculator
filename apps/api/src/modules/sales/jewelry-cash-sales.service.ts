import { Inject, Injectable } from '@nestjs/common';
import { InventoryMovementsService } from '../inventory/inventory-movements.service';
import { LedgerAccountsService } from '../ledger/ledger-accounts.service';
import { AssetDimensionsService } from '../ledger/asset-dimensions.service';
import { LedgerPostingService } from '../ledger/ledger-posting.service';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesPricingService } from './sales-pricing.service';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

export interface CreateJewelryCashSaleInput {
  readonly tenantId: string;
  readonly partyId: string;
  readonly jewelryItemId: string;
  readonly quoteId: string;
  readonly effectiveAt: Date;
  readonly createdBy: string;
}

export interface CreatedJewelryCashSale {
  readonly invoiceId: string;
  readonly invoiceNumber: number;
  readonly payableRial: bigint;
  readonly ledgerTransactionId: string;
  readonly inventoryMovementId: string;
}

/** A cash jewelry sale is one invoice, one inventory movement, and one balanced posting. */
@Injectable()
export class JewelryCashSalesService {
  constructor(
    @Inject(SalesInvoicesService) private readonly invoices: SalesInvoicesService,
    @Inject(SalesPricingService) private readonly pricing: SalesPricingService,
    @Inject(InventoryMovementsService) private readonly movements: InventoryMovementsService,
    @Inject(LedgerAccountsService) private readonly accounts: LedgerAccountsService,
    @Inject(LedgerPostingService) private readonly ledger: LedgerPostingService,
    @Inject(AssetDimensionsService) private readonly dimensions: AssetDimensionsService,
  ) {}

  async createInTransaction(
    transaction: TenantTransaction,
    input: CreateJewelryCashSaleInput,
  ): Promise<CreatedJewelryCashSale> {
    const invoice = await this.invoices.createDraftInTransaction(transaction, {
      tenantId: input.tenantId,
      partyId: input.partyId,
      createdBy: input.createdBy,
    });
    const price = await this.pricing.priceJewelryInTransaction(transaction, input);
    const finalized = await this.invoices.finalizeInTransaction(transaction, {
      tenantId: input.tenantId,
      salesInvoiceId: invoice.id,
      effectiveAt: input.effectiveAt,
      quoteId: price.quoteId,
      quoteAmountRial: BigInt(price.quoteAmountRial),
      quoteObservedAt: new Date(price.quoteObservedAt),
      totalsSnapshot: {
        payableRial: price.payableRial,
        payableBeforeRoundingRial: price.payableBeforeRoundingRial,
        goldValueRial: price.goldValueRial,
        wageRial: price.wageRial,
        profitRial: price.profitRial,
        taxRial: price.taxRial,
        pureWeightMg: price.pureWeightMg,
      },
      settingsSnapshot: price.settingsSnapshot,
      items: [
        {
          itemType: 'JEWELRY',
          itemId: input.jewelryItemId,
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
      ],
      createdBy: input.createdBy,
    });
    const movement = await this.movements.recordInTransaction(transaction, input.tenantId, {
      sourceType: 'SALE',
      sourceId: finalized.invoice.id,
      itemType: 'JEWELRY',
      itemId: input.jewelryItemId,
      quantity: -1n,
      occurredAt: input.effectiveAt,
    });
    const [cash, salesRevenue, cogsJewelry, inventoryJewelry] = await Promise.all([
      this.accounts.getRequiredSystemAccountInTransaction(transaction, input.tenantId, 'CASH'),
      this.accounts.getRequiredSystemAccountInTransaction(transaction, input.tenantId, 'SALES_REVENUE'),
      this.accounts.getRequiredSystemAccountInTransaction(transaction, input.tenantId, 'COGS_JEWELRY'),
      this.accounts.getRequiredSystemAccountInTransaction(transaction, input.tenantId, 'INVENTORY_JEWELRY'),
    ]);
    const rial = await this.dimensions.getRequiredBaseDimensionInTransaction(
      transaction,
      input.tenantId,
      'RIAL',
    );
    const posting = await this.ledger.postInTransaction(transaction, {
      source: { tenantId: input.tenantId, type: 'SALES_INVOICE', id: finalized.invoice.id },
      effectiveAt: input.effectiveAt,
      description: `Cash jewelry sale ${finalized.invoice.invoiceNumber!}`,
      createdBy: input.createdBy,
      entries: [
        { accountId: cash.id, dimensionId: rial.id, quantity: BigInt(price.payableRial) },
        { accountId: salesRevenue.id, dimensionId: rial.id, quantity: -BigInt(price.payableRial) },
        { accountId: cogsJewelry.id, dimensionId: movement.dimensionId, quantity: BigInt(price.pureWeightMg) },
        { accountId: inventoryJewelry.id, dimensionId: movement.dimensionId, quantity: -BigInt(price.pureWeightMg) },
      ],
    });

    return {
      invoiceId: finalized.invoice.id,
      invoiceNumber: finalized.invoice.invoiceNumber!,
      payableRial: BigInt(price.payableRial),
      ledgerTransactionId: posting.transaction.id,
      inventoryMovementId: movement.id,
    };
  }

}
