import { Inject, Injectable } from '@nestjs/common';
import { articlePureMg, grossMg, karat } from '@gold/core-calc';
import { openingBalances } from '../../platform/database/schema';
import { normalizeTextForStorage } from '../../shared/validation';
import { AuditService } from '../../platform/audit/audit.service';
import { LedgerAccountsService } from '../ledger/ledger-accounts.service';
import { LedgerPostingService } from '../ledger/ledger-posting.service';
import { CoinTypesService } from './coin-types.service';
import { InventoryMovementsService } from './inventory-movements.service';
import { JewelryItemsService } from './jewelry-items.service';
import {
  OpeningBalanceCoinTypeUnavailableError,
  OpeningBalanceJewelryPureWeightZeroError,
} from './opening-balances.errors';
import type {
  InventoryMovement,
  LedgerEntryMetadata,
  OpeningBalance,
} from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

export type OpeningBalanceLineInput =
  | {
      readonly itemType: 'JEWELRY';
      readonly itemId: string;
      readonly quantity: bigint;
    }
  | {
      readonly itemType: 'MELTED_GOLD';
      readonly quantity: bigint;
    }
  | {
      readonly itemType: 'COIN';
      readonly itemId: string;
      readonly quantity: bigint;
    };

export interface CreateOpeningBalanceInput {
  readonly tenantId: string;
  readonly effectiveAt: Date;
  readonly description: string;
  readonly lines: readonly OpeningBalanceLineInput[];
  readonly createdBy: string;
}

export interface CreatedOpeningBalance {
  readonly openingBalance: OpeningBalance;
  readonly ledgerTransactionId: string;
  readonly movements: readonly InventoryMovement[];
}

interface PreparedOpeningLine {
  readonly movement: {
    readonly itemType: 'JEWELRY' | 'MELTED_GOLD' | 'COIN';
    readonly itemId?: string | null | undefined;
    readonly quantity: bigint;
  };
  readonly ledgerQuantity: bigint;
  readonly inventoryAccountSystemKey: string;
  readonly metadata: LedgerEntryMetadata;
}

/**
 * Opening inventory flow — one source document, append-only inventory movement
 * rows, and a multi-dimensional ledger transaction in one PostgreSQL
 * transaction. Coin quantities never use a gold-weight conversion here.
 */
@Injectable()
export class OpeningBalancesService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CoinTypesService) private readonly coinTypes: CoinTypesService,
    @Inject(InventoryMovementsService) private readonly movements: InventoryMovementsService,
    @Inject(JewelryItemsService) private readonly jewelryItems: JewelryItemsService,
    @Inject(LedgerAccountsService) private readonly ledgerAccounts: LedgerAccountsService,
    @Inject(LedgerPostingService) private readonly ledgerPosting: LedgerPostingService,
  ) {}

  async createInTransaction(
    transaction: TenantTransaction,
    input: CreateOpeningBalanceInput,
  ): Promise<CreatedOpeningBalance> {
    const description = normalizeTextForStorage(input.description).trim();
    const [created] = await transaction
      .insert(openingBalances)
      .values({
        tenantId: input.tenantId,
        effectiveAt: input.effectiveAt,
        description,
        createdBy: input.createdBy,
      })
      .returning();
    const openingBalance = created!;

    const preparedLines: PreparedOpeningLine[] = [];
    for (const line of input.lines) {
      preparedLines.push(await this.prepareLine(transaction, input, line));
    }

    const recordedMovements = await this.movements.recordManyInTransaction(
      transaction,
      input.tenantId,
      preparedLines.map((line) => ({
        sourceType: 'OPENING_BALANCE' as const,
        sourceId: openingBalance.id,
        itemType: line.movement.itemType,
        itemId: line.movement.itemId,
        quantity: line.movement.quantity,
        occurredAt: input.effectiveAt,
      })),
    );

    const openingEquity = await this.ledgerAccounts.getRequiredSystemAccountInTransaction(
      transaction,
      input.tenantId,
      'OPENING_EQUITY',
    );
    const accountBySystemKey = new Map<string, string>();

    for (const line of preparedLines) {
      if (!accountBySystemKey.has(line.inventoryAccountSystemKey)) {
        const account = await this.ledgerAccounts.getRequiredSystemAccountInTransaction(
          transaction,
          input.tenantId,
          line.inventoryAccountSystemKey,
        );
        accountBySystemKey.set(line.inventoryAccountSystemKey, account.id);
      }
    }

    const posting = await this.ledgerPosting.postInTransaction(transaction, {
      source: {
        tenantId: input.tenantId,
        type: 'OPENING_BALANCE',
        id: openingBalance.id,
      },
      effectiveAt: input.effectiveAt,
      description,
      createdBy: input.createdBy,
      entries: preparedLines.flatMap((line, index) => {
        const movement = recordedMovements[index]!;
        const inventoryAccountId = accountBySystemKey.get(line.inventoryAccountSystemKey)!;

        return [
          {
            accountId: inventoryAccountId,
            dimensionId: movement.dimensionId,
            quantity: line.ledgerQuantity,
            metadata: line.metadata,
          },
          {
            accountId: openingEquity.id,
            dimensionId: movement.dimensionId,
            quantity: -line.ledgerQuantity,
            metadata: line.metadata,
          },
        ];
      }),
    });

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: input.createdBy,
      action: 'OPENING_BALANCE_CREATED',
      entityType: 'opening_balance',
      entityId: openingBalance.id,
      afterData: {
        effectiveAt: openingBalance.effectiveAt.toISOString(),
        ledgerTransactionId: posting.transaction.id,
        inventoryMovementIds: recordedMovements.map((movement) => movement.id),
      },
    });

    return {
      openingBalance,
      ledgerTransactionId: posting.transaction.id,
      movements: recordedMovements,
    };
  }

  private async prepareLine(
    transaction: TenantTransaction,
    input: CreateOpeningBalanceInput,
    line: OpeningBalanceLineInput,
  ): Promise<PreparedOpeningLine> {
    if (line.itemType === 'MELTED_GOLD') {
      return {
        movement: { itemType: line.itemType, itemId: null, quantity: line.quantity },
        ledgerQuantity: line.quantity,
        inventoryAccountSystemKey: 'INVENTORY_MELTED_GOLD',
        metadata: { itemType: line.itemType, quantity: line.quantity.toString() },
      };
    }

    if (line.itemType === 'COIN') {
      const version = await this.coinTypes.getEffectiveInTransaction(
        transaction,
        input.tenantId,
        line.itemId,
        input.effectiveAt,
      );
      if (version === undefined || !version.active) {
        throw new OpeningBalanceCoinTypeUnavailableError(line.itemId);
      }

      return {
        movement: { itemType: line.itemType, itemId: line.itemId, quantity: line.quantity },
        // This is a count, not a converted gold weight.
        ledgerQuantity: line.quantity,
        inventoryAccountSystemKey: `INVENTORY_COIN:${line.itemId}`,
        metadata: {
          itemType: line.itemType,
          itemId: line.itemId,
          quantity: line.quantity.toString(),
        },
      };
    }

    const version = await this.jewelryItems.requireSelectableForSaleInTransaction(
      transaction,
      input.tenantId,
      line.itemId,
      input.effectiveAt,
    );
    const pureWeightPerItemMg = articlePureMg(
      grossMg(version.grossWeightMg),
      {
        stone: grossMg(version.stoneWeightMg),
        other: grossMg(version.otherDeductionWeightMg),
      },
      karat(version.karat),
    );
    if (pureWeightPerItemMg === 0n) {
      throw new OpeningBalanceJewelryPureWeightZeroError(line.itemId);
    }

    return {
      movement: { itemType: line.itemType, itemId: line.itemId, quantity: line.quantity },
      ledgerQuantity: pureWeightPerItemMg * line.quantity,
      inventoryAccountSystemKey: 'INVENTORY_JEWELRY',
      metadata: {
        itemType: line.itemType,
        itemId: line.itemId,
        quantity: line.quantity.toString(),
        jewelryItemVersionId: version.id,
        pureWeightPerItemMg: pureWeightPerItemMg.toString(),
      },
    };
  }
}
