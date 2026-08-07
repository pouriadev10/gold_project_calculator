import { describe, expect, it } from 'vitest';
import { createOpeningBalanceSchema, openingBalanceLineSchema } from '../src/index.js';

const jewelryId = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';
const coinId = '4f2504e0-4f89-41d3-9a0c-0305e82c3302';

describe('opening balance contracts', () => {
  it('keeps opening quantities as positive integer strings', () => {
    const parsed = createOpeningBalanceSchema.parse({
      effectiveAt: '2026-08-06T00:00:00Z',
      description: 'موجودی شروع',
      lines: [
        { itemType: 'JEWELRY', itemId: jewelryId, quantity: '2' },
        { itemType: 'MELTED_GOLD', quantity: '15000' },
        { itemType: 'COIN', itemId: coinId, quantity: '3' },
      ],
    });

    expect(parsed.lines).toHaveLength(3);
    expect(typeof parsed.lines[1]!.quantity).toBe('string');
  });

  it.each(['0', '-1', '2.5', 2])(
    'rejects non-positive or non-string quantities: %s',
    (quantity) => {
      expect(
        openingBalanceLineSchema.safeParse({
          itemType: 'MELTED_GOLD',
          quantity,
        }).success,
      ).toBe(false);
    },
  );

  it('does not allow a melted-gold line to carry an item identity', () => {
    expect(
      openingBalanceLineSchema.safeParse({
        itemType: 'MELTED_GOLD',
        itemId: jewelryId,
        quantity: '1',
      }).success,
    ).toBe(false);
  });
});
