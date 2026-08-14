import { Inject, Injectable } from '@nestjs/common';
import { InventoryMovementsService } from '../inventory/inventory-movements.service';
import { AssetDimensionsService } from '../ledger/asset-dimensions.service';
import { LedgerAccountsService } from '../ledger/ledger-accounts.service';
import { LedgerPostingService } from '../ledger/ledger-posting.service';
import type { LedgerPostingEntryInput } from '../ledger/ledger-posting.service';
import { CoinSalePaidRialExceedsPayableError } from './coin-sales.errors';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesPricingService } from './sales-pricing.service';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

export interface CreateCoinSaleInput {
  readonly tenantId: string;
  readonly partyId: string;
  readonly coinTypeId: string;
  readonly count: number;
  readonly marketUnitPriceRial: bigint;
  readonly quoteId: string;
  readonly effectiveAt: Date;
  /** مبلغ پرداختی امروز. کمتر از مبلغ محاسبه‌شده یعنی باقی روی طلب شخص می‌نشیند. */
  readonly paidRial: bigint;
  readonly createdBy: string;
}

export interface CreatedCoinSale {
  readonly invoiceId: string;
  readonly invoiceNumber: number;
  readonly payableRial: bigint;
  readonly receivableRial: bigint;
  readonly intrinsicValueRial: bigint;
  readonly bubbleRial: bigint | null;
  readonly ledgerTransactionId: string;
  readonly inventoryMovementId: string;
}

/**
 * فروش سکه — BE-043. یک فاکتور، یک inventory movement بر اساس تعداد (نه
 * وزن)، و یک posting متوازن روی بُعد `COIN:<coinTypeId>`. الگوی پرداخت/طلب
 * دقیقاً آینه‌ی `JewelryCreditSalesService` است، اما اینجا در یک endpoint
 * واحد ادغام شده چون تسک ورودی «پرداخت» را از ابتدا کنار تعداد و قیمت بازار
 * می‌خواهد، نه در یک مسیر نقدی جدا.
 */
@Injectable()
export class CoinSalesService {
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
    input: CreateCoinSaleInput,
  ): Promise<CreatedCoinSale> {
    const invoice = await this.invoices.createDraftInTransaction(transaction, input);
    const price = await this.pricing.priceCoinInTransaction(transaction, input);
    const payableRial = BigInt(price.payableRial);

    if (input.paidRial > payableRial) {
      throw new CoinSalePaidRialExceedsPayableError();
    }
    const receivableRial = payableRial - input.paidRial;

    const finalized = await this.invoices.finalizeInTransaction(transaction, {
      tenantId: input.tenantId,
      salesInvoiceId: invoice.id,
      effectiveAt: input.effectiveAt,
      quoteId: price.quoteId,
      quoteAmountRial: BigInt(price.quoteAmountRial),
      quoteObservedAt: new Date(price.quoteObservedAt),
      totalsSnapshot: {
        payableRial: price.payableRial,
        paidRial: input.paidRial.toString(),
        receivableRial: receivableRial.toString(),
        count: price.count.toString(),
        marketUnitPriceRial: price.marketUnitPriceRial,
        intrinsicValueRial: price.intrinsicValueRial,
        bubbleRial: price.bubbleRial,
      },
      settingsSnapshot: price.settingsSnapshot,
      items: [
        {
          itemType: 'COIN',
          itemId: input.coinTypeId,
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
      ],
      createdBy: input.createdBy,
    });

    const movement = await this.movements.recordInTransaction(transaction, input.tenantId, {
      sourceType: 'SALE',
      sourceId: finalized.invoice.id,
      itemType: 'COIN',
      itemId: input.coinTypeId,
      quantity: -BigInt(price.count),
      occurredAt: input.effectiveAt,
    });

    const [cash, salesRevenue, cogsCoin, coinInventory, partyAccounts, rial] = await Promise.all([
      this.accounts.getRequiredSystemAccountInTransaction(transaction, input.tenantId, 'CASH'),
      this.accounts.getRequiredSystemAccountInTransaction(transaction, input.tenantId, 'SALES_REVENUE'),
      this.accounts.getRequiredSystemAccountInTransaction(transaction, input.tenantId, 'COGS_COIN'),
      this.accounts.getRequiredSystemAccountInTransaction(
        transaction,
        input.tenantId,
        `INVENTORY_COIN:${input.coinTypeId}`,
      ),
      this.accounts.ensurePartyAccountsInTransaction(transaction, {
        tenantId: input.tenantId,
        partyId: input.partyId,
      }),
      this.dimensions.getRequiredBaseDimensionInTransaction(transaction, input.tenantId, 'RIAL'),
    ]);

    const entries: LedgerPostingEntryInput[] = [
      ...(input.paidRial === 0n
        ? []
        : [{ accountId: cash.id, dimensionId: rial.id, quantity: input.paidRial }]),
      ...(receivableRial === 0n
        ? []
        : [{ accountId: partyAccounts.receivable.id, dimensionId: rial.id, quantity: receivableRial }]),
      { accountId: salesRevenue.id, dimensionId: rial.id, quantity: -payableRial },
      { accountId: cogsCoin.id, dimensionId: movement.dimensionId, quantity: BigInt(price.count) },
      { accountId: coinInventory.id, dimensionId: movement.dimensionId, quantity: -BigInt(price.count) },
    ];

    const posting = await this.ledger.postInTransaction(transaction, {
      source: { tenantId: input.tenantId, type: 'SALES_INVOICE', id: finalized.invoice.id },
      effectiveAt: input.effectiveAt,
      description: `Coin sale ${finalized.invoice.invoiceNumber!}`,
      createdBy: input.createdBy,
      entries,
    });

    return {
      invoiceId: finalized.invoice.id,
      invoiceNumber: finalized.invoice.invoiceNumber!,
      payableRial,
      receivableRial,
      intrinsicValueRial: BigInt(price.intrinsicValueRial),
      bubbleRial: price.bubbleRial === null ? null : BigInt(price.bubbleRial),
      ledgerTransactionId: posting.transaction.id,
      inventoryMovementId: movement.id,
    };
  }
}
