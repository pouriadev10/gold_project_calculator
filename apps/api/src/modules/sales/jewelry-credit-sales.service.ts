import { Inject, Injectable } from '@nestjs/common';
import { InventoryMovementsService } from '../inventory/inventory-movements.service';
import { AssetDimensionsService } from '../ledger/asset-dimensions.service';
import { LedgerAccountsService } from '../ledger/ledger-accounts.service';
import { LedgerPostingService } from '../ledger/ledger-posting.service';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesPricingService } from './sales-pricing.service';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

export interface CreateJewelryCreditSaleInput {
  readonly tenantId: string; readonly partyId: string; readonly jewelryItemId: string; readonly quoteId: string;
  readonly effectiveAt: Date; readonly paidRial: bigint; readonly createdBy: string;
}
export interface CreatedJewelryCreditSale {
  readonly invoiceId: string; readonly invoiceNumber: number; readonly payableRial: bigint; readonly receivableRial: bigint;
  readonly ledgerTransactionId: string; readonly inventoryMovementId: string;
}

@Injectable()
export class JewelryCreditSalesService {
  constructor(
    @Inject(SalesInvoicesService) private readonly invoices: SalesInvoicesService,
    @Inject(SalesPricingService) private readonly pricing: SalesPricingService,
    @Inject(InventoryMovementsService) private readonly movements: InventoryMovementsService,
    @Inject(LedgerAccountsService) private readonly accounts: LedgerAccountsService,
    @Inject(LedgerPostingService) private readonly ledger: LedgerPostingService,
    @Inject(AssetDimensionsService) private readonly dimensions: AssetDimensionsService,
  ) {}
  async createInTransaction(transaction: TenantTransaction, input: CreateJewelryCreditSaleInput): Promise<CreatedJewelryCreditSale> {
    const invoice = await this.invoices.createDraftInTransaction(transaction, input);
    const price = await this.pricing.priceJewelryInTransaction(transaction, input);
    const payableRial = BigInt(price.payableRial);
    if (input.paidRial > payableRial) throw new Error('Paid Rial cannot exceed the calculated invoice total');
    const receivableRial = payableRial - input.paidRial;
    const finalized = await this.invoices.finalizeInTransaction(transaction, {
      tenantId: input.tenantId, salesInvoiceId: invoice.id, effectiveAt: input.effectiveAt, quoteId: price.quoteId,
      quoteAmountRial: BigInt(price.quoteAmountRial), quoteObservedAt: new Date(price.quoteObservedAt),
      totalsSnapshot: { payableRial: price.payableRial, paidRial: input.paidRial.toString(), receivableRial: receivableRial.toString(), pureWeightMg: price.pureWeightMg },
      settingsSnapshot: price.settingsSnapshot,
      items: [{ itemType: 'JEWELRY', itemId: input.jewelryItemId, quantity: 1, lineSnapshot: { jewelryItemVersionId: price.jewelryItemVersionId, pureWeightMg: price.pureWeightMg, payableRial: price.payableRial } }],
      createdBy: input.createdBy,
    });
    const movement = await this.movements.recordInTransaction(transaction, input.tenantId, { sourceType: 'SALE', sourceId: invoice.id, itemType: 'JEWELRY', itemId: input.jewelryItemId, quantity: -1n, occurredAt: input.effectiveAt });
    const [cash, revenue, cogs, inventory, partyAccounts, rial] = await Promise.all([
      this.accounts.getRequiredSystemAccountInTransaction(transaction, input.tenantId, 'CASH'), this.accounts.getRequiredSystemAccountInTransaction(transaction, input.tenantId, 'SALES_REVENUE'),
      this.accounts.getRequiredSystemAccountInTransaction(transaction, input.tenantId, 'COGS_JEWELRY'), this.accounts.getRequiredSystemAccountInTransaction(transaction, input.tenantId, 'INVENTORY_JEWELRY'),
      this.accounts.ensurePartyAccountsInTransaction(transaction, { tenantId: input.tenantId, partyId: input.partyId }), this.dimensions.getRequiredBaseDimensionInTransaction(transaction, input.tenantId, 'RIAL'),
    ]);
    const entries = [
      ...(input.paidRial === 0n ? [] : [{ accountId: cash.id, dimensionId: rial.id, quantity: input.paidRial }]),
      ...(receivableRial === 0n ? [] : [{ accountId: partyAccounts.receivable.id, dimensionId: rial.id, quantity: receivableRial }]),
      { accountId: revenue.id, dimensionId: rial.id, quantity: -payableRial },
      { accountId: cogs.id, dimensionId: movement.dimensionId, quantity: BigInt(price.pureWeightMg) },
      { accountId: inventory.id, dimensionId: movement.dimensionId, quantity: -BigInt(price.pureWeightMg) },
    ];
    const posting = await this.ledger.postInTransaction(transaction, { source: { tenantId: input.tenantId, type: 'SALES_INVOICE', id: finalized.invoice.id }, effectiveAt: input.effectiveAt, description: `Credit jewelry sale ${finalized.invoice.invoiceNumber!}`, createdBy: input.createdBy, entries });
    return { invoiceId: finalized.invoice.id, invoiceNumber: finalized.invoice.invoiceNumber!, payableRial, receivableRial, ledgerTransactionId: posting.transaction.id, inventoryMovementId: movement.id };
  }
}
