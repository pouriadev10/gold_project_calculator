/**
 * Pure explanation of the difference between a prior jewelry sale and a
 * current B2C second-hand buyback. The prior sale is informational only: no
 * value from it changes the current purchase posting.
 */

import { valueOfPure } from './pricing.js';
import { CalcError, rial } from './types.js';
import type { PureMg, Rial } from './types.js';

export interface B2cBuybackDifferenceInput {
  readonly originalPurchaseAmountRial: Rial;
  readonly originalGoldValueRial: Rial;
  readonly originalWageRial: Rial;
  readonly originalPureWeightMg: PureMg;
  /** Current second-hand price before an optional current-purchase deduction. */
  readonly todayGrossPurchaseAmountRial: Rial;
  /** Amount actually payable on the new purchase after its own deduction. */
  readonly todayPurchaseAmountRial: Rial;
  readonly todayGoldRatePerGramRial: Rial;
}

export interface B2cBuybackDifference {
  /** Today’s new-purchase amount minus the original sale amount; may be either sign. */
  readonly differenceRial: Rial;
  /** A positive display amount: the original jewelry wage is not returned. */
  readonly wageBurnedRial: Rial;
  /** Effect of today’s effective purchase karat (and newly measured pure weight). */
  readonly karatDifferenceRial: Rial;
  /** Effect of valuing the original pure weight at today’s locked gold rate. */
  readonly marketPriceDifferenceRial: Rial;
  /** Profit, tax, any current purchase deduction, and exact rounding residuals. */
  readonly otherCalculationDifferenceRial: Rial;
}

function requireNonNegative(value: bigint, field: string): void {
  if (value < 0n) {
    throw new CalcError(`${field} cannot be negative`);
  }
}

/**
 * Decomposes the signed difference as:
 *
 * `difference = marketPriceDifference + karatDifference - wageBurned + other`.
 *
 * This is a reporting calculation only. The new purchase is independently
 * valued and posted by `calculateSecondHandGoldPurchase`.
 */
export function calculateB2cBuybackDifference(
  input: B2cBuybackDifferenceInput,
): B2cBuybackDifference {
  requireNonNegative(input.originalPurchaseAmountRial, 'Original purchase amount');
  requireNonNegative(input.originalGoldValueRial, 'Original gold value');
  requireNonNegative(input.originalWageRial, 'Original wage');
  requireNonNegative(input.todayGrossPurchaseAmountRial, 'Today gross purchase amount');
  requireNonNegative(input.todayPurchaseAmountRial, 'Today purchase amount');
  requireNonNegative(input.todayGoldRatePerGramRial, 'Today gold rate');

  const originalPureAtTodayRateRial = valueOfPure(
    input.originalPureWeightMg,
    input.todayGoldRatePerGramRial,
  );
  const marketPriceDifferenceRial = rial(originalPureAtTodayRateRial - input.originalGoldValueRial);
  const karatDifferenceRial = rial(
    input.todayGrossPurchaseAmountRial - originalPureAtTodayRateRial,
  );
  const differenceRial = rial(input.todayPurchaseAmountRial - input.originalPurchaseAmountRial);
  const otherCalculationDifferenceRial = rial(
    differenceRial - marketPriceDifferenceRial - karatDifferenceRial + input.originalWageRial,
  );

  return {
    differenceRial,
    wageBurnedRial: input.originalWageRial,
    karatDifferenceRial,
    marketPriceDifferenceRial,
    otherCalculationDifferenceRial,
  };
}
