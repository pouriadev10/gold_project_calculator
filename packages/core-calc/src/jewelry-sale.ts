/**
 * Canonical Phase-1 jewelry-sale calculation.
 *
 * This is deliberately pure: the API resolves the effective item version,
 * market quote, and versioned policies, then gives their values to this
 * function. Keeping the formula here prevents browser and server totals from
 * drifting apart.
 */

import { articlePureMg, chargeableGrossMg } from './article.js';
import { gramRate } from './pricing.js';
import { mulDivHalfUp, roundHalfUp } from './rounding.js';
import { CalcError, grossMg, rial } from './types.js';
import type { ArticleDeductions } from './article.js';
import type { Karat, PureMg, Rial } from './types.js';

const BPS_SCALE = 10_000n;
const MG_PER_GRAM = 1_000n;

export type JewelryWageType = 'PER_GRAM' | 'PERCENT_X100' | 'FLAT';

export interface JewelrySaleCalculationInput {
  readonly grossWeightMg: bigint;
  readonly karat: Karat;
  readonly deductions: ArticleDeductions;
  readonly wageType: JewelryWageType;
  readonly wageValue: bigint;
  readonly maznehRial: bigint;
  readonly profitRateBps: bigint;
  readonly taxRateBps: bigint;
  readonly roundingUnitRial: bigint;
  readonly rateDivisor: bigint;
}

export interface JewelrySaleCalculation {
  readonly pureWeightMg: PureMg;
  readonly goldRatePerGramRial: Rial;
  readonly goldValueRial: Rial;
  readonly wageRial: Rial;
  readonly profitRial: Rial;
  readonly taxRial: Rial;
  readonly payableBeforeRoundingRial: Rial;
  readonly payableRial: Rial;
}

/** Converts versioned market-convention values to `gramRate`'s integer divisor. */
export function rateDivisorFromMarketSettings(
  baseQuoteKarat: Karat,
  mithqalGramsX10k: bigint,
): bigint {
  if (mithqalGramsX10k <= 0n) {
    throw new CalcError('Mithqal grams must be positive');
  }

  return mithqalGramsX10k * BigInt(baseQuoteKarat);
}

function requireNonNegative(value: bigint, field: string): void {
  if (value < 0n) {
    throw new CalcError(`${field} cannot be negative`);
  }
}

function wageFor(
  wageType: JewelryWageType,
  wageValue: bigint,
  chargeableWeightMg: bigint,
  goldValueRial: Rial,
): Rial {
  switch (wageType) {
    case 'PER_GRAM':
      return rial(mulDivHalfUp(chargeableWeightMg, wageValue, MG_PER_GRAM));
    case 'PERCENT_X100':
      return rial(mulDivHalfUp(goldValueRial, wageValue, BPS_SCALE));
    case 'FLAT':
      return rial(wageValue);
  }
}

/**
 * Computes a jewelry line entirely in integer Rial/milligram arithmetic.
 * Tax is restricted to wage and profit; gold value is never in its tax base.
 * `roundHalfUp` is called exactly once for the final payable amount.
 */
export function calculateJewelrySale(
  input: JewelrySaleCalculationInput,
): JewelrySaleCalculation {
  requireNonNegative(input.wageValue, 'Wage value');
  requireNonNegative(input.maznehRial, 'Mazneh');
  requireNonNegative(input.profitRateBps, 'Profit rate');
  requireNonNegative(input.taxRateBps, 'Tax rate');

  const gross = grossMg(input.grossWeightMg);
  const chargeableWeightMg = chargeableGrossMg(gross, input.deductions);
  const pureWeightMg = articlePureMg(gross, input.deductions, input.karat);
  const goldRatePerGramRial = gramRate(input.maznehRial, input.karat, input.rateDivisor);
  const goldValueRial = rial(
    mulDivHalfUp(chargeableWeightMg, goldRatePerGramRial, MG_PER_GRAM),
  );
  const wageRial = wageFor(
    input.wageType,
    input.wageValue,
    chargeableWeightMg,
    goldValueRial,
  );
  const profitRial = rial(mulDivHalfUp(goldValueRial + wageRial, input.profitRateBps, BPS_SCALE));
  const taxRial = rial(mulDivHalfUp(wageRial + profitRial, input.taxRateBps, BPS_SCALE));
  const payableBeforeRoundingRial = rial(goldValueRial + wageRial + profitRial + taxRial);

  return {
    pureWeightMg,
    goldRatePerGramRial,
    goldValueRial,
    wageRial,
    profitRial,
    taxRial,
    payableBeforeRoundingRial,
    payableRial: rial(roundHalfUp(payableBeforeRoundingRial, input.roundingUnitRial)),
  };
}
