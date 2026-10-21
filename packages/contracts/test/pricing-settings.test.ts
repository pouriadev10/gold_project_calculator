import { describe, expect, it } from 'vitest';
import { MAX_PAGE_SIZE } from '../src/common/pagination.js';
import { updateGeneralSettingSchema } from '../src/pricing/general-settings.js';
import { priceQuoteHistoryQuerySchema } from '../src/pricing/price-quotes.js';

describe('updateGeneralSettingSchema — canonical values (M-13)', () => {
  it('stores numeric values without leading zeros, so locked snapshots stay readable', () => {
    expect(updateGeneralSettingSchema.parse({ key: 'pricing.rial_rounding_unit', value: '01000' })).toEqual({
      key: 'pricing.rial_rounding_unit',
      value: '1000',
    });
    expect(
      updateGeneralSettingSchema.parse({ key: 'purchase.second_hand_default_karat', value: ' 0740 ' }).value,
    ).toBe('740');
    expect(
      updateGeneralSettingSchema.parse({ key: 'sales.invoice_correction_window_minutes', value: '000' }).value,
    ).toBe('0');
    expect(updateGeneralSettingSchema.parse({ key: 'pricing.rounding_policy', value: 'HALF_UP' }).value).toBe(
      'HALF_UP',
    );
  });

  it('still rejects invalid values instead of canonicalizing them', () => {
    expect(updateGeneralSettingSchema.safeParse({ key: 'pricing.rial_rounding_unit', value: '000' }).success).toBe(
      false,
    );
    expect(
      updateGeneralSettingSchema.safeParse({ key: 'purchase.second_hand_default_karat', value: '7.5' }).success,
    ).toBe(false);
  });
});

describe('priceQuoteHistoryQuerySchema — bounded history (M-13)', () => {
  it('defaults to the newest page and caps the page size', () => {
    expect(priceQuoteHistoryQuerySchema.parse({ quoteType: 'MAZNEH' })).toEqual({
      quoteType: 'MAZNEH',
      limit: MAX_PAGE_SIZE,
    });
    expect(priceQuoteHistoryQuerySchema.parse({ limit: '20' })).toEqual({ limit: 20 });
    expect(priceQuoteHistoryQuerySchema.safeParse({ limit: String(MAX_PAGE_SIZE + 1) }).success).toBe(false);
    expect(priceQuoteHistoryQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(priceQuoteHistoryQuerySchema.safeParse({ offset: '10' }).success).toBe(false);
  });
});
