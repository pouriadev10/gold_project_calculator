import { describe, expect, it } from 'vitest';
import { calculateSecondHandGoldPurchase } from '../src/second-hand-purchase.js';
import { CalcError, grossMg, karat } from '../src/types.js';

const baseInput = {
  grossWeightMg: 1_000n,
  deductions: { stone: grossMg(100n), other: grossMg(0n) },
  purchaseKarat: karat(740),
  maznehRial: 100_000_000n,
  feeRial: 25_000n,
  roundingUnitRial: 1_000n,
  rateDivisor: 32_488_515n,
};

describe('calculateSecondHandGoldPurchase', () => {
  it('deducts non-gold weight before karat, values pure gold at the 1000-karat rate, then rounds once', () => {
    expect(calculateSecondHandGoldPurchase(baseInput)).toEqual({
      pureWeightMg: 666n,
      goldRatePerGramRial: 30_780_107n,
      grossPurchaseAmountRial: 20_499_551n,
      finalAmountRial: 20_475_000n,
    });
  });

  it('D-01: rounds pure weight to whole milligrams first, then values the rial from that same weight', () => {
    // 1001 mg × 740 ÷ 1000 = 740.74 mg pure → 741 mg, exactly what the ledger records.
    // Valuing the unrounded 740.74 mg would give 22_800_056 (→ 22_800_000); the decision
    // accepts that difference so the rial matches «recorded mg × locked rate».
    expect(
      calculateSecondHandGoldPurchase({
        ...baseInput,
        grossWeightMg: 1_001n,
        deductions: { stone: grossMg(0n), other: grossMg(0n) },
        feeRial: 0n,
      }),
    ).toEqual({
      pureWeightMg: 741n,
      goldRatePerGramRial: 30_780_107n,
      grossPurchaseAmountRial: 22_808_059n,
      finalAmountRial: 22_808_000n,
    });
  });

  it('does not use any original-sale wage and rejects invalid current purchase inputs', () => {
    expect(() =>
      calculateSecondHandGoldPurchase({
        ...baseInput,
        deductions: { stone: grossMg(1_000n), other: grossMg(0n) },
      }),
    ).toThrow(CalcError);
    expect(() => calculateSecondHandGoldPurchase({ ...baseInput, feeRial: -1n })).toThrow(
      CalcError,
    );
    expect(() => calculateSecondHandGoldPurchase({ ...baseInput, feeRial: 20_499_552n })).toThrow(
      CalcError,
    );
    expect(() =>
      calculateSecondHandGoldPurchase({
        ...baseInput,
        maznehRial: 0n,
        feeRial: 0n,
      }),
    ).toThrow(CalcError);
  });
});
