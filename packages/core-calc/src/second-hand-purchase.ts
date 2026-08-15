/**
 * Canonical calculation for buying second-hand gold from a consumer.
 *
 * The source article is reduced for stones and non-gold deductions before its
 * karat is applied. The acquired pure-gold position is then valued at the
 * locked 1000-karat gold rate. No original sale wage participates in this new
 * purchase calculation.
 */

import { articlePureMg } from './article.js';
import { gramRate1000, valueOfPure } from './pricing.js';
import { roundHalfUp } from './rounding.js';
import { CalcError, grossMg, rial } from './types.js';
import type { ArticleDeductions } from './article.js';
import type { Karat, PureMg, Rial } from './types.js';

export interface SecondHandGoldPurchaseCalculationInput {
  readonly grossWeightMg: bigint;
  readonly deductions: ArticleDeductions;
  readonly purchaseKarat: Karat;
  readonly maznehRial: bigint;
  readonly feeRial: bigint;
  readonly roundingUnitRial: bigint;
  readonly rateDivisor: bigint;
}

export interface SecondHandGoldPurchaseCalculation {
  readonly pureWeightMg: PureMg;
  readonly goldRatePerGramRial: Rial;
  readonly grossPurchaseAmountRial: Rial;
  readonly finalAmountRial: Rial;
}

function requireNonNegative(value: bigint, field: string): void {
  if (value < 0n) {
    throw new CalcError(`${field} cannot be negative`);
  }
}

/**
 * Calculates the current purchase amount with only bigint arithmetic.
 * `roundHalfUp` runs once on the final amount after the current purchase fee.
 */
export function calculateSecondHandGoldPurchase(
  input: SecondHandGoldPurchaseCalculationInput,
): SecondHandGoldPurchaseCalculation {
  requireNonNegative(input.maznehRial, 'Mazneh');
  requireNonNegative(input.feeRial, 'Purchase fee');

  const pureWeightMg = articlePureMg(
    grossMg(input.grossWeightMg),
    input.deductions,
    input.purchaseKarat,
  );
  if (pureWeightMg === 0n) {
    throw new CalcError('Second-hand purchase must contain positive pure gold');
  }

  const goldRatePerGramRial = gramRate1000(input.maznehRial, input.rateDivisor);
  const grossPurchaseAmountRial = valueOfPure(pureWeightMg, goldRatePerGramRial);
  if (input.feeRial > grossPurchaseAmountRial) {
    throw new CalcError('Purchase fee cannot exceed the gross purchase amount');
  }

  const finalAmountRial = rial(
    roundHalfUp(grossPurchaseAmountRial - input.feeRial, input.roundingUnitRial),
  );
  if (finalAmountRial === 0n) {
    throw new CalcError('Second-hand purchase final amount must be positive');
  }

  return {
    pureWeightMg,
    goldRatePerGramRial,
    grossPurchaseAmountRial,
    finalAmountRial,
  };
}
