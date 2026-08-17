import { describe, expect, it } from 'vitest';
import {
  createSecondHandGoldPurchaseSchema,
  secondHandGoldPurchaseSchema,
} from '../src/purchase/second-hand-gold-purchases.js';

const uuid = 'e11c72a7-42b1-4f7c-b878-3ee8e98f985c';
const validInput = {
  partyId: uuid,
  grossWeightMg: '1000',
  quoteId: uuid,
  effectiveAt: '2026-08-15T10:30:00.000Z',
};

describe('second-hand gold purchase contracts', () => {
  it('uses JSON strings for money and weights and defaults optional zero-value inputs', () => {
    expect(createSecondHandGoldPurchaseSchema.parse(validInput)).toMatchObject({
      stoneWeightMg: '0',
      otherDeductionWeightMg: '0',
      feeRial: '0',
      paidRial: '0',
    });
  });

  it('permits a tenant-derived karat but rejects floating money, weight, and unknown fields', () => {
    expect(
      createSecondHandGoldPurchaseSchema.parse({ ...validInput, purchaseKarat: 740 }).purchaseKarat,
    ).toBe(740);
    expect(
      createSecondHandGoldPurchaseSchema.safeParse({ ...validInput, grossWeightMg: 1000 }).success,
    ).toBe(false);
    expect(
      createSecondHandGoldPurchaseSchema.safeParse({ ...validInput, feeRial: '1.5' }).success,
    ).toBe(false);
    expect(
      createSecondHandGoldPurchaseSchema.safeParse({ ...validInput, pureWeightMg: '740' }).success,
    ).toBe(false);
  });

  it('exposes only server-calculated purchase totals', () => {
    expect(
      secondHandGoldPurchaseSchema.parse({
        secondHandPurchaseId: uuid,
        ledgerTransactionId: uuid,
        inventoryMovementId: uuid,
        pureWeightMg: '740',
        goldRatePerGramRial: '50000000',
        grossPurchaseAmountRial: '37000000',
        feeRial: '0',
        finalAmountRial: '37000000',
        paidRial: '0',
        payableRial: '37000000',
      }),
    ).toMatchObject({ finalAmountRial: '37000000', payableRial: '37000000' });
  });
});
