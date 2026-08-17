import { describe, expect, it } from 'vitest';
import { calculateB2cBuybackDifference } from '../src/b2c-buyback.js';
import { CalcError, pureMg, rial } from '../src/types.js';

describe('calculateB2cBuybackDifference', () => {
  const baseInput = {
    originalPurchaseAmountRial: rial(25_000_000n),
    originalGoldValueRial: rial(20_000_000n),
    originalWageRial: rial(1_000_000n),
    originalPureWeightMg: pureMg(750n),
    todayGrossPurchaseAmountRial: rial(20_000_000n),
    todayPurchaseAmountRial: rial(20_000_000n),
    todayGoldRatePerGramRial: rial(30_000_000n),
  };

  it('explains a signed buyback difference without changing today’s independently calculated amount', () => {
    expect(calculateB2cBuybackDifference(baseInput)).toEqual({
      differenceRial: -5_000_000n,
      wageBurnedRial: 1_000_000n,
      karatDifferenceRial: -2_500_000n,
      marketPriceDifferenceRial: 2_500_000n,
      otherCalculationDifferenceRial: -4_000_000n,
    });
  });

  it('permits either direction of the signed comparison and rejects impossible amount inputs', () => {
    expect(
      calculateB2cBuybackDifference({ ...baseInput, todayPurchaseAmountRial: rial(30_000_000n) })
        .differenceRial,
    ).toBe(5_000_000n);
    expect(() =>
      calculateB2cBuybackDifference({ ...baseInput, originalWageRial: rial(-1n) }),
    ).toThrow(CalcError);
  });
});
