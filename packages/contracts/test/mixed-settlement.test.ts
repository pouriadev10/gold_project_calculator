import { describe, expect, it } from 'vitest';
import { createMixedSettlementSchema, MAX_MIXED_SETTLEMENT_LINES } from '../src/settlement/mixed-settlement.js';

const rialLine = { type: 'RIAL', amountRial: '1000' } as const;

describe('createMixedSettlementSchema — bounded lines (M-18)', () => {
  it('accepts up to the line cap and rejects one more', () => {
    const at = '2026-10-27T08:00:00.000Z';
    expect(
      createMixedSettlementSchema.safeParse({
        lines: Array.from({ length: MAX_MIXED_SETTLEMENT_LINES }, () => rialLine),
        effectiveAt: at,
      }).success,
    ).toBe(true);
    expect(
      createMixedSettlementSchema.safeParse({
        lines: Array.from({ length: MAX_MIXED_SETTLEMENT_LINES + 1 }, () => rialLine),
        effectiveAt: at,
      }).success,
    ).toBe(false);
    expect(createMixedSettlementSchema.safeParse({ lines: [], effectiveAt: at }).success).toBe(false);
  });
});
