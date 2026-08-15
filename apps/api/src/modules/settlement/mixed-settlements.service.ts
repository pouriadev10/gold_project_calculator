import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  bubble,
  coinPositionValue,
  gramRate1000,
  grossMg,
  grossUg,
  intrinsicValue,
  karat,
  rateDivisorFromMarketSettings,
  rial,
  toPureMg,
  toSafeNumber,
  valueOfPure,
} from '@gold/core-calc';
import { priceQuotes } from '../../platform/database/schema';
import { CoinTypesService } from '../inventory/coin-types.service';
import { InventoryMovementsService } from '../inventory/inventory-movements.service';
import { AccountBalanceService } from '../ledger/account-balance.service';
import { AssetDimensionsService } from '../ledger/asset-dimensions.service';
import { LedgerAccountsService } from '../ledger/ledger-accounts.service';
import { LedgerPostingService } from '../ledger/ledger-posting.service';
import { VersionedSettingsService } from '../pricing/versioned-settings.service';
import {
  MixedSettlementInsufficientCreditError,
  MixedSettlementInvalidInputError,
  MixedSettlementPricingSettingInvalidError,
  MixedSettlementQuoteNotFoundError,
} from './mixed-settlements.errors';
import { SettlementsService } from './settlements.service';
import type { LedgerPostingEntryInput } from '../ledger/ledger-posting.service';
import type { RecordInventoryMovementInput } from '../inventory/inventory-movements.service';
import type { FinalizeSettlementLineInput } from './settlements.service';
import type { CoinType } from '@gold/core-calc';
import type {
  CoinTypeVersion,
  SettlementLineSnapshotValue,
  VersionedSetting,
  VersionedSettingValue,
} from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

const SETTING_KEYS = {
  baseQuoteKarat: 'pricing.base_quote_karat',
  mithqalGrams: 'pricing.mithqal_grams',
} as const;

export type MixedSettlementLineInput =
  | { readonly type: 'RIAL'; readonly amountRial: bigint }
  | {
      readonly type: 'GOLD';
      readonly grossWeightMg: bigint;
      readonly karat: number;
      readonly quoteId: string;
    }
  | {
      readonly type: 'COIN';
      readonly coinTypeId: string;
      readonly count: number;
      readonly marketUnitPriceRial: bigint;
      readonly quoteId: string;
    }
  | { readonly type: 'CREDIT'; readonly amountRial: bigint };

export interface CreateMixedSettlementInput {
  readonly tenantId: string;
  readonly partyId: string;
  readonly lines: readonly MixedSettlementLineInput[];
  readonly effectiveAt: Date;
  readonly createdBy: string;
}

export type MixedSettlementResultLine =
  | { readonly type: 'RIAL'; readonly settledRial: bigint }
  | {
      readonly type: 'GOLD';
      readonly inventoryMovementId: string;
      readonly pureWeightMg: bigint;
      readonly settledRial: bigint;
      readonly goldRatePerGramRial: bigint;
    }
  | {
      readonly type: 'COIN';
      readonly inventoryMovementId: string;
      readonly coinTypeId: string;
      readonly count: number;
      readonly settledRial: bigint;
      readonly intrinsicValueRial: bigint;
      readonly bubbleRial: bigint | null;
    }
  | { readonly type: 'CREDIT'; readonly settledRial: bigint };

export interface CreatedMixedSettlement {
  readonly settlementId: string;
  readonly ledgerTransactionId: string;
  readonly totalSettledRial: bigint;
  readonly lines: readonly MixedSettlementResultLine[];
}

type ValuedMixedSettlementLine =
  | { readonly type: 'RIAL'; readonly settledRial: bigint }
  | {
      readonly type: 'GOLD';
      readonly pureWeightMg: bigint;
      readonly settledRial: bigint;
      readonly goldRatePerGramRial: bigint;
      readonly lockedQuoteId: string;
      readonly lockedQuoteAmountRial: bigint;
      readonly lockedConversionSnapshot: SettlementLineSnapshotValue;
    }
  | {
      readonly type: 'COIN';
      readonly coinTypeId: string;
      readonly count: number;
      readonly settledRial: bigint;
      readonly intrinsicValueRial: bigint;
      readonly bubbleRial: bigint | null;
      readonly lockedQuoteId: string;
      readonly lockedQuoteAmountRial: bigint;
      readonly lockedConversionSnapshot: SettlementLineSnapshotValue;
    }
  | { readonly type: 'CREDIT'; readonly settledRial: bigint };

function isSettingRecord(
  value: VersionedSettingValue,
): value is { readonly [key: string]: VersionedSettingValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function settingString(setting: VersionedSetting | undefined, key: string): string {
  if (setting === undefined || !isSettingRecord(setting.valueJson)) {
    throw new MixedSettlementPricingSettingInvalidError(key);
  }

  const value = setting.valueJson['value'];
  if (typeof value !== 'string') {
    throw new MixedSettlementPricingSettingInvalidError(key);
  }

  return value;
}

function positiveIntegerSetting(setting: VersionedSetting | undefined, key: string): bigint {
  const value = settingString(setting, key);
  if (!/^\d+$/u.test(value)) {
    throw new MixedSettlementPricingSettingInvalidError(key);
  }

  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new MixedSettlementPricingSettingInvalidError(key);
  }

  return parsed;
}

function mithqalGramsX10k(setting: VersionedSetting | undefined): bigint {
  const value = settingString(setting, SETTING_KEYS.mithqalGrams);
  const match = /^(\d+)\.(\d{4})$/u.exec(value);
  if (match === null || BigInt(match[1]!) <= 0n) {
    throw new MixedSettlementPricingSettingInvalidError(SETTING_KEYS.mithqalGrams);
  }

  return BigInt(`${match[1]}${match[2]}`);
}

function toCoinType(version: CoinTypeVersion): CoinType {
  const base = {
    kind: 'coin' as const,
    id: version.coinTypeId,
    label: version.title,
    grossWeightUg: grossUg(version.grossWeightUg),
    karat: karat(version.karat),
  };

  return version.isCentralBankMinted
    ? { ...base, isCentralBankMinted: true }
    : { ...base, isCentralBankMinted: false };
}

/**
 * One settlement header, one atomic inventory batch, and one ledger
 * transaction. Every gold/coin conversion is valued and snapshotted per line.
 */
@Injectable()
export class MixedSettlementsService {
  constructor(
    @Inject(SettlementsService) private readonly settlements: SettlementsService,
    @Inject(CoinTypesService) private readonly coinTypes: CoinTypesService,
    @Inject(InventoryMovementsService) private readonly movements: InventoryMovementsService,
    @Inject(AccountBalanceService) private readonly balances: AccountBalanceService,
    @Inject(LedgerAccountsService) private readonly accounts: LedgerAccountsService,
    @Inject(LedgerPostingService) private readonly ledger: LedgerPostingService,
    @Inject(AssetDimensionsService) private readonly dimensions: AssetDimensionsService,
    @Inject(VersionedSettingsService) private readonly settings: VersionedSettingsService,
  ) {}

  async createInTransaction(
    transaction: TenantTransaction,
    input: CreateMixedSettlementInput,
  ): Promise<CreatedMixedSettlement> {
    if (input.lines.length === 0) {
      throw new MixedSettlementInvalidInputError(
        'A mixed settlement must contain at least one line',
      );
    }

    const valuedLines = await Promise.all(
      input.lines.map((line) => this.valueLineInTransaction(transaction, input, line)),
    );
    const totalSettledRial = valuedLines.reduce((total, line) => total + line.settledRial, 0n);
    const draft = await this.settlements.createDraftInTransaction(transaction, input);

    const [partyAccounts, cash, meltedGold, clearing, rialDimension, goldDimension] =
      await Promise.all([
        this.accounts.ensurePartyAccountsInTransaction(transaction, {
          tenantId: input.tenantId,
          partyId: input.partyId,
        }),
        this.accounts.getRequiredSystemAccountInTransaction(transaction, input.tenantId, 'CASH'),
        this.accounts.getRequiredSystemAccountInTransaction(
          transaction,
          input.tenantId,
          'INVENTORY_MELTED_GOLD',
        ),
        this.accounts.getRequiredSystemAccountInTransaction(
          transaction,
          input.tenantId,
          'SETTLEMENT_CONVERSION_CLEARING',
        ),
        this.dimensions.getRequiredBaseDimensionInTransaction(transaction, input.tenantId, 'RIAL'),
        this.dimensions.getRequiredBaseDimensionInTransaction(transaction, input.tenantId, 'GOLD'),
      ]);

    const creditAppliedRial = valuedLines.reduce(
      (total, line) => total + (line.type === 'CREDIT' ? line.settledRial : 0n),
      0n,
    );
    if (creditAppliedRial > 0n) {
      const payableBalance = await this.balances.getAccountBalancesInTransaction(
        transaction,
        input.tenantId,
        partyAccounts.payable.id,
      );
      const availableCreditRial = BigInt(payableBalance.rial ?? '0');
      const availableCreditToApply = availableCreditRial < 0n ? -availableCreditRial : 0n;
      if (creditAppliedRial > availableCreditToApply) {
        throw new MixedSettlementInsufficientCreditError(availableCreditToApply, creditAppliedRial);
      }
    }

    const settlementLines: FinalizeSettlementLineInput[] = [];
    const ledgerEntries: LedgerPostingEntryInput[] = [];
    for (const line of valuedLines) {
      switch (line.type) {
        case 'RIAL':
          settlementLines.push({
            lineType: 'RIAL',
            dimensionId: rialDimension.id,
            quantity: line.settledRial,
            sourceAccountId: partyAccounts.receivable.id,
            destinationAccountId: cash.id,
          });
          ledgerEntries.push(
            { accountId: cash.id, dimensionId: rialDimension.id, quantity: line.settledRial },
            {
              accountId: partyAccounts.receivable.id,
              dimensionId: rialDimension.id,
              quantity: -line.settledRial,
            },
          );
          break;
        case 'GOLD':
          settlementLines.push(
            {
              lineType: 'GOLD',
              dimensionId: goldDimension.id,
              quantity: line.pureWeightMg,
              sourceAccountId: clearing.id,
              destinationAccountId: meltedGold.id,
              lockedQuoteId: line.lockedQuoteId,
              lockedQuoteAmountRial: line.lockedQuoteAmountRial,
              lockedConversionSnapshot: line.lockedConversionSnapshot,
            },
            {
              lineType: 'RIAL',
              dimensionId: rialDimension.id,
              quantity: line.settledRial,
              sourceAccountId: partyAccounts.receivable.id,
              destinationAccountId: clearing.id,
              lockedQuoteId: line.lockedQuoteId,
              lockedQuoteAmountRial: line.lockedQuoteAmountRial,
              lockedConversionSnapshot: line.lockedConversionSnapshot,
            },
          );
          ledgerEntries.push(
            {
              accountId: meltedGold.id,
              dimensionId: goldDimension.id,
              quantity: line.pureWeightMg,
            },
            {
              accountId: clearing.id,
              dimensionId: goldDimension.id,
              quantity: -line.pureWeightMg,
            },
            {
              accountId: partyAccounts.receivable.id,
              dimensionId: rialDimension.id,
              quantity: -line.settledRial,
            },
            {
              accountId: clearing.id,
              dimensionId: rialDimension.id,
              quantity: line.settledRial,
            },
          );
          break;
        case 'COIN': {
          const [coinInventory, coinDimension] = await Promise.all([
            this.accounts.getRequiredSystemAccountInTransaction(
              transaction,
              input.tenantId,
              `INVENTORY_COIN:${line.coinTypeId}`,
            ),
            this.dimensions.resolveInventoryDimensionInTransaction(
              transaction,
              input.tenantId,
              'COIN',
              line.coinTypeId,
            ),
          ]);
          const quantity = BigInt(line.count);
          settlementLines.push(
            {
              lineType: 'COIN',
              dimensionId: coinDimension.id,
              quantity,
              sourceAccountId: clearing.id,
              destinationAccountId: coinInventory.id,
              lockedQuoteId: line.lockedQuoteId,
              lockedQuoteAmountRial: line.lockedQuoteAmountRial,
              lockedConversionSnapshot: line.lockedConversionSnapshot,
            },
            {
              lineType: 'RIAL',
              dimensionId: rialDimension.id,
              quantity: line.settledRial,
              sourceAccountId: partyAccounts.receivable.id,
              destinationAccountId: clearing.id,
              lockedQuoteId: line.lockedQuoteId,
              lockedQuoteAmountRial: line.lockedQuoteAmountRial,
              lockedConversionSnapshot: line.lockedConversionSnapshot,
            },
          );
          ledgerEntries.push(
            { accountId: coinInventory.id, dimensionId: coinDimension.id, quantity },
            { accountId: clearing.id, dimensionId: coinDimension.id, quantity: -quantity },
            {
              accountId: partyAccounts.receivable.id,
              dimensionId: rialDimension.id,
              quantity: -line.settledRial,
            },
            {
              accountId: clearing.id,
              dimensionId: rialDimension.id,
              quantity: line.settledRial,
            },
          );
          break;
        }
        case 'CREDIT':
          settlementLines.push({
            lineType: 'CREDIT',
            dimensionId: rialDimension.id,
            quantity: line.settledRial,
            sourceAccountId: partyAccounts.receivable.id,
            destinationAccountId: partyAccounts.payable.id,
          });
          ledgerEntries.push(
            {
              accountId: partyAccounts.payable.id,
              dimensionId: rialDimension.id,
              quantity: line.settledRial,
            },
            {
              accountId: partyAccounts.receivable.id,
              dimensionId: rialDimension.id,
              quantity: -line.settledRial,
            },
          );
          break;
      }
    }

    const finalized = await this.settlements.finalizeInTransaction(transaction, {
      tenantId: input.tenantId,
      settlementId: draft.id,
      effectiveAt: input.effectiveAt,
      createdBy: input.createdBy,
      lines: settlementLines,
    });
    const movementInputs: RecordInventoryMovementInput[] = [];
    for (const line of valuedLines) {
      if (line.type === 'GOLD') {
        movementInputs.push({
          sourceType: 'SETTLEMENT',
          sourceId: finalized.settlement.id,
          itemType: 'MELTED_GOLD',
          quantity: line.pureWeightMg,
          occurredAt: input.effectiveAt,
        });
      }
      if (line.type === 'COIN') {
        movementInputs.push({
          sourceType: 'SETTLEMENT',
          sourceId: finalized.settlement.id,
          itemType: 'COIN',
          itemId: line.coinTypeId,
          quantity: BigInt(line.count),
          occurredAt: input.effectiveAt,
        });
      }
    }
    const movements = await this.movements.recordManyInTransaction(
      transaction,
      input.tenantId,
      movementInputs,
    );
    const posting = await this.ledger.postInTransaction(transaction, {
      source: { tenantId: input.tenantId, type: 'SETTLEMENT', id: finalized.settlement.id },
      effectiveAt: input.effectiveAt,
      description: `Mixed settlement ${finalized.settlement.id}`,
      createdBy: input.createdBy,
      entries: ledgerEntries,
    });

    const resultLines: MixedSettlementResultLine[] = [];
    let movementIndex = 0;
    for (const line of valuedLines) {
      switch (line.type) {
        case 'RIAL':
          resultLines.push({ type: 'RIAL', settledRial: line.settledRial });
          break;
        case 'GOLD': {
          const movement = movements[movementIndex++]!;
          resultLines.push({
            type: 'GOLD',
            inventoryMovementId: movement.id,
            pureWeightMg: line.pureWeightMg,
            settledRial: line.settledRial,
            goldRatePerGramRial: line.goldRatePerGramRial,
          });
          break;
        }
        case 'COIN': {
          const movement = movements[movementIndex++]!;
          resultLines.push({
            type: 'COIN',
            inventoryMovementId: movement.id,
            coinTypeId: line.coinTypeId,
            count: line.count,
            settledRial: line.settledRial,
            intrinsicValueRial: line.intrinsicValueRial,
            bubbleRial: line.bubbleRial,
          });
          break;
        }
        case 'CREDIT':
          resultLines.push({ type: 'CREDIT', settledRial: line.settledRial });
          break;
      }
    }

    return {
      settlementId: finalized.settlement.id,
      ledgerTransactionId: posting.transaction.id,
      totalSettledRial,
      lines: resultLines,
    };
  }

  private async valueLineInTransaction(
    transaction: TenantTransaction,
    input: CreateMixedSettlementInput,
    line: MixedSettlementLineInput,
  ): Promise<ValuedMixedSettlementLine> {
    switch (line.type) {
      case 'RIAL':
      case 'CREDIT':
        if (line.amountRial <= 0n) {
          throw new MixedSettlementInvalidInputError(
            `${line.type} settlement amount must be positive`,
          );
        }
        return { type: line.type, settledRial: line.amountRial };
      case 'GOLD':
        return this.valueGoldLineInTransaction(transaction, input, line);
      case 'COIN':
        return this.valueCoinLineInTransaction(transaction, input, line);
    }
  }

  private async valueGoldLineInTransaction(
    transaction: TenantTransaction,
    input: CreateMixedSettlementInput,
    line: Extract<MixedSettlementLineInput, { readonly type: 'GOLD' }>,
  ): Promise<ValuedMixedSettlementLine> {
    const [quote, baseQuoteKarat, mithqalGrams] = await Promise.all([
      transaction
        .select()
        .from(priceQuotes)
        .where(and(eq(priceQuotes.tenantId, input.tenantId), eq(priceQuotes.id, line.quoteId)))
        .limit(1)
        .then(([found]) => found),
      this.settings.getEffectiveInTransaction(
        transaction,
        input.tenantId,
        SETTING_KEYS.baseQuoteKarat,
        input.effectiveAt,
      ),
      this.settings.getEffectiveInTransaction(
        transaction,
        input.tenantId,
        SETTING_KEYS.mithqalGrams,
        input.effectiveAt,
      ),
    ]);
    if (quote === undefined || quote.quoteType !== 'MAZNEH' || quote.amountRial <= 0n) {
      throw new MixedSettlementQuoteNotFoundError();
    }

    const pureWeightMg = toPureMg(grossMg(line.grossWeightMg), karat(line.karat));
    if (pureWeightMg <= 0n) {
      throw new MixedSettlementInvalidInputError(
        'Gold settlement weight becomes zero after karat normalization',
      );
    }
    const baseKarat = positiveIntegerSetting(baseQuoteKarat, SETTING_KEYS.baseQuoteKarat);
    if (baseKarat > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new MixedSettlementPricingSettingInvalidError(SETTING_KEYS.baseQuoteKarat);
    }
    const rateDivisor = rateDivisorFromMarketSettings(
      karat(toSafeNumber(baseKarat)),
      mithqalGramsX10k(mithqalGrams),
    );
    const goldRatePerGramRial = gramRate1000(quote.amountRial, rateDivisor);
    const settledRial = valueOfPure(pureWeightMg, goldRatePerGramRial);

    return {
      type: 'GOLD',
      pureWeightMg,
      settledRial,
      goldRatePerGramRial,
      lockedQuoteId: quote.id,
      lockedQuoteAmountRial: quote.amountRial,
      lockedConversionSnapshot: {
        quoteType: quote.quoteType,
        quoteObservedAt: quote.observedAt.toISOString(),
        baseQuoteKarat: settingString(baseQuoteKarat, SETTING_KEYS.baseQuoteKarat),
        mithqalGrams: settingString(mithqalGrams, SETTING_KEYS.mithqalGrams),
        rateDivisor: rateDivisor.toString(),
        goldRatePerGramRial: goldRatePerGramRial.toString(),
      },
    };
  }

  private async valueCoinLineInTransaction(
    transaction: TenantTransaction,
    input: CreateMixedSettlementInput,
    line: Extract<MixedSettlementLineInput, { readonly type: 'COIN' }>,
  ): Promise<ValuedMixedSettlementLine> {
    if (!Number.isSafeInteger(line.count) || line.count <= 0) {
      throw new MixedSettlementInvalidInputError(
        'Coin settlement count must be a positive integer',
      );
    }
    if (line.marketUnitPriceRial <= 0n) {
      throw new MixedSettlementInvalidInputError(
        'Coin settlement market unit price must be positive',
      );
    }

    const [version, quote, baseQuoteKarat, mithqalGrams] = await Promise.all([
      this.coinTypes.requireSelectableForSaleInTransaction(
        transaction,
        input.tenantId,
        line.coinTypeId,
        input.effectiveAt,
      ),
      transaction
        .select()
        .from(priceQuotes)
        .where(and(eq(priceQuotes.tenantId, input.tenantId), eq(priceQuotes.id, line.quoteId)))
        .limit(1)
        .then(([found]) => found),
      this.settings.getEffectiveInTransaction(
        transaction,
        input.tenantId,
        SETTING_KEYS.baseQuoteKarat,
        input.effectiveAt,
      ),
      this.settings.getEffectiveInTransaction(
        transaction,
        input.tenantId,
        SETTING_KEYS.mithqalGrams,
        input.effectiveAt,
      ),
    ]);
    if (quote === undefined || quote.quoteType !== 'MAZNEH' || quote.amountRial <= 0n) {
      throw new MixedSettlementQuoteNotFoundError();
    }

    const baseKarat = positiveIntegerSetting(baseQuoteKarat, SETTING_KEYS.baseQuoteKarat);
    if (baseKarat > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new MixedSettlementPricingSettingInvalidError(SETTING_KEYS.baseQuoteKarat);
    }
    const goldRate1000Rial = gramRate1000(
      quote.amountRial,
      rateDivisorFromMarketSettings(karat(toSafeNumber(baseKarat)), mithqalGramsX10k(mithqalGrams)),
    );
    const coin = toCoinType(version);
    const marketUnitPriceRial = rial(line.marketUnitPriceRial);
    const intrinsicValueRial = intrinsicValue(coin, goldRate1000Rial);
    const bubbleRial = coin.isCentralBankMinted
      ? bubble(coin, marketUnitPriceRial, goldRate1000Rial)
      : null;
    const settledRial = coinPositionValue(line.count, marketUnitPriceRial);

    return {
      type: 'COIN',
      coinTypeId: line.coinTypeId,
      count: line.count,
      settledRial,
      intrinsicValueRial,
      bubbleRial,
      lockedQuoteId: quote.id,
      lockedQuoteAmountRial: quote.amountRial,
      lockedConversionSnapshot: {
        coinTypeVersionId: version.id,
        marketUnitPriceRial: marketUnitPriceRial.toString(),
        quoteType: quote.quoteType,
        quoteObservedAt: quote.observedAt.toISOString(),
        goldRate1000Rial: goldRate1000Rial.toString(),
        intrinsicValueRial: intrinsicValueRial.toString(),
        bubbleRial: bubbleRial === null ? null : bubbleRial.toString(),
        baseQuoteKarat: settingString(baseQuoteKarat, SETTING_KEYS.baseQuoteKarat),
        mithqalGrams: settingString(mithqalGrams, SETTING_KEYS.mithqalGrams),
      },
    };
  }
}
