import { describe, expect, it } from 'vitest';
import {
  b2cBuybackPreviewSchema,
  b2cBuybackSchema,
  createB2cBuybackSchema,
  previewB2cBuybackSchema,
} from '../src/purchase/b2c-buybacks.js';

const uuid = 'e11c72a7-42b1-4f7c-b878-3ee8e98f985c';
const validInput = {
  grossWeightMg: '1000',
  quoteId: uuid,
  effectiveAt: '2026-08-15T10:30:00.000Z',
};

describe('B2C buyback contracts', () => {
  it('accepts only newly measured second-hand purchase inputs and defaults zero-value fields', () => {
    expect(createB2cBuybackSchema.parse(validInput)).toMatchObject({
      stoneWeightMg: '0',
      otherDeductionWeightMg: '0',
      paidRial: '0',
    });
  });

  it('does not accept an original party, invoice amount, or any floating weight/money', () => {
    expect(
      createB2cBuybackSchema.safeParse({ ...validInput, originalPurchaseAmountRial: '1' }).success,
    ).toBe(false);
    expect(createB2cBuybackSchema.safeParse({ ...validInput, grossWeightMg: 1000 }).success).toBe(
      false,
    );
    expect(createB2cBuybackSchema.safeParse({ ...validInput, paidRial: '1.5' }).success).toBe(
      false,
    );
  });

  it('uses the same newly measured inputs for a side-effect-free preview, without payment', () => {
    expect(previewB2cBuybackSchema.parse(validInput)).toMatchObject({
      stoneWeightMg: '0',
      otherDeductionWeightMg: '0',
    });
    expect(previewB2cBuybackSchema.safeParse({ ...validInput, paidRial: '1' }).success).toBe(false);
  });

  it('returns separately locked original and today event data with the backend breakdown', () => {
    expect(
      b2cBuybackPreviewSchema.parse({
        sourceInvoiceId: uuid,
        original: {
          effectiveAt: '2026-08-10T10:30:00.000Z',
          quoteAmountRial: '100000000',
          quoteObservedAt: '2026-08-10T10:00:00.000Z',
          goldRatePerGramRial: '30000000',
          purchaseAmountRial: '50000000',
        },
        today: {
          effectiveAt: validInput.effectiveAt,
          quoteAmountRial: '200000000',
          quoteObservedAt: '2026-08-15T10:00:00.000Z',
          goldRatePerGramRial: '60000000',
          purchaseAmountRial: '37000000',
        },
        breakdown: {
          originalPurchaseAmountRial: '50000000',
          todayPurchaseAmountRial: '37000000',
          differenceRial: '-13000000',
          wageBurnedRial: '1000000',
          karatDifferenceRial: '-500000',
          marketPriceDifferenceRial: '2000000',
          otherCalculationDifferenceRial: '-13500000',
        },
      }),
    ).toMatchObject({
      original: { quoteAmountRial: '100000000' },
      today: { goldRatePerGramRial: '60000000' },
    });
  });

  it('returns the signed difference breakdown separately from the new purchase totals', () => {
    expect(
      b2cBuybackSchema.parse({
        secondHandPurchaseId: uuid,
        ledgerTransactionId: uuid,
        inventoryMovementId: uuid,
        sourceInvoiceId: uuid,
        pureWeightMg: '740',
        goldRatePerGramRial: '50000000',
        paidRial: '0',
        payableRial: '37000000',
        breakdown: {
          originalPurchaseAmountRial: '50000000',
          todayPurchaseAmountRial: '37000000',
          differenceRial: '-13000000',
          wageBurnedRial: '1000000',
          karatDifferenceRial: '-500000',
          marketPriceDifferenceRial: '2000000',
          otherCalculationDifferenceRial: '-13500000',
        },
      }),
    ).toMatchObject({
      sourceInvoiceId: uuid,
      breakdown: { differenceRial: '-13000000', wageBurnedRial: '1000000' },
    });
  });
});
