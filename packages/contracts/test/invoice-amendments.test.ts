import { describe, expect, it } from 'vitest';
import { amendSalesInvoiceSchema } from '../src/sales/invoice-amendments.js';

const PARTY_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';

describe('invoice amendment contract (BE-054)', () => {
  it('accepts source facts for a jewelry correction without accepting client totals', () => {
    const parsed = amendSalesInvoiceSchema.parse({
      reason: 'WEIGHT_ERROR',
      partyId: PARTY_ID,
      item: { itemType: 'JEWELRY', jewelryItemId: ITEM_ID, paidRial: '0' },
    });

    expect(parsed.item).toMatchObject({ itemType: 'JEWELRY', paidRial: '0' });
    expect('payableRial' in parsed).toBe(false);
  });

  it('requires a nonblank explanation for OTHER and keeps coin counts integral', () => {
    expect(
      amendSalesInvoiceSchema.safeParse({
        reason: 'OTHER',
        partyId: PARTY_ID,
        item: {
          itemType: 'COIN',
          coinTypeId: ITEM_ID,
          count: 1,
          marketUnitPriceRial: '1',
          paidRial: '0',
        },
      }).success,
    ).toBe(false);
    expect(
      amendSalesInvoiceSchema.safeParse({
        reason: 'OTHER',
        reasonDetail: 'Wrong market price was entered',
        partyId: PARTY_ID,
        item: {
          itemType: 'COIN',
          coinTypeId: ITEM_ID,
          count: 1.5,
          marketUnitPriceRial: '1',
          paidRial: '0',
        },
      }).success,
    ).toBe(false);
  });
});
