import { describe, expect, it } from 'vitest';
import {
  createSecondHandCoinPurchaseSchema,
  secondHandCoinPurchaseSchema,
} from '../src/purchase/second-hand-coin-purchases.js';

const uuid = 'e11c72a7-42b1-4f7c-b878-3ee8e98f985c';
const validInput = {
  partyId: uuid,
  coinTypeId: uuid,
  count: 2,
  purchaseUnitPriceRial: '250000000',
  quoteId: uuid,
  effectiveAt: '2026-08-15T10:30:00.000Z',
};

describe('second-hand coin purchase contracts', () => {
  it('keeps the coin quantity as an integer and monetary values as JSON strings', () => {
    expect(createSecondHandCoinPurchaseSchema.parse(validInput)).toMatchObject({
      count: 2,
      purchaseUnitPriceRial: '250000000',
      paidRial: '0',
    });
  });

  it('rejects a fractional count, floating money, and any coin weight input', () => {
    expect(
      createSecondHandCoinPurchaseSchema.safeParse({ ...validInput, count: 1.5 }).success,
    ).toBe(false);
    expect(
      createSecondHandCoinPurchaseSchema.safeParse({
        ...validInput,
        purchaseUnitPriceRial: 250000000,
      }).success,
    ).toBe(false);
    expect(
      createSecondHandCoinPurchaseSchema.safeParse({ ...validInput, grossWeightMg: '1000' })
        .success,
    ).toBe(false);
  });

  it('makes purchase totals server-calculated and allows a bubble only as a report value', () => {
    expect(
      secondHandCoinPurchaseSchema.parse({
        secondHandPurchaseId: uuid,
        ledgerTransactionId: uuid,
        inventoryMovementId: uuid,
        coinTypeId: uuid,
        count: 2,
        purchaseUnitPriceRial: '250000000',
        purchaseAmountRial: '500000000',
        paidRial: '100000000',
        payableRial: '400000000',
        intrinsicValueRial: '200000000',
        bubbleRial: '50000000',
      }),
    ).toMatchObject({ purchaseAmountRial: '500000000', payableRial: '400000000' });
  });
});
