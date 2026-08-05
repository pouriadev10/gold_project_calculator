import { describe, expect, it } from 'vitest';
import {
  inventoryBalanceSchema,
  inventoryItemTypeSchema,
  inventoryMovementSchema,
  inventoryMovementSourceTypeSchema,
} from '../src/index.js';

const valid = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3401',
  sourceType: 'SALE',
  sourceId: '3f2504e0-4f89-41d3-9a0c-0305e82c3402',
  itemType: 'JEWELRY',
  itemId: '3f2504e0-4f89-41d3-9a0c-0305e82c3403',
  dimensionId: null,
  quantity: '-2',
  occurredAt: '2026-02-01T00:00:00Z',
  createdAt: '2026-02-01T00:00:00Z',
};

describe('inventoryItemTypeSchema', () => {
  it('فقط سه نوع فاز ۱ را می‌شناسد', () => {
    expect(inventoryItemTypeSchema.options).toEqual(['JEWELRY', 'MELTED_GOLD', 'COIN']);
  });

  it('سکه نوع مستقل است و به وزن تبدیل نمی‌شود', () => {
    // قاعده‌ی ۲-۲: اگر سکه با وزن ذخیره شود، موقعیت حبابی گم می‌شود.
    expect(inventoryItemTypeSchema.options).toContain('COIN');
    expect(inventoryItemTypeSchema.safeParse('COIN_GRAMS').success).toBe(false);
  });
});

describe('inventoryMovementSourceTypeSchema', () => {
  it('فهرست منابع بسته است، نه متن آزاد', () => {
    expect(inventoryMovementSourceTypeSchema.options).toEqual([
      'OPENING_BALANCE',
      'SALE',
      'PURCHASE',
      'CORRECTION',
    ]);
    expect(inventoryMovementSourceTypeSchema.safeParse('SOMETHING').success).toBe(false);
  });
});

describe('inventoryMovementSchema', () => {
  it('حرکت خروجی با مقدار منفی معتبر است', () => {
    expect(inventoryMovementSchema.parse(valid).quantity).toBe('-2');
  });

  it('آبشده بدون شناسه‌ی کالا معتبر است', () => {
    const parsed = inventoryMovementSchema.parse({
      ...valid,
      itemType: 'MELTED_GOLD',
      itemId: null,
      quantity: '7319700',
    });

    expect(parsed.itemId).toBeNull();
  });

  it('مقدار بزرگ‌تر از محدوده‌ی امن number رقم گم نمی‌کند', () => {
    const huge = '9007199254740993';

    expect(inventoryMovementSchema.parse({ ...valid, quantity: huge }).quantity).toBe(huge);
  });

  it.each([
    ['اعشاری', '2.5'],
    ['عدد به‌جای رشته', 2],
    ['ارقام فارسی', '۲'],
    ['صفر ابتدایی', '02'],
    ['خالی', ''],
  ])('مقدار نامعتبر رد می‌شود: %s', (_label, quantity) => {
    expect(inventoryMovementSchema.safeParse({ ...valid, quantity }).success).toBe(false);
  });

  it('بُعد دفتر کل فعلاً می‌تواند خالی باشد — BE-030 پرش می‌کند', () => {
    expect(inventoryMovementSchema.parse(valid).dimensionId).toBeNull();
    expect(
      inventoryMovementSchema.parse({ ...valid, dimensionId: valid.sourceId }).dimensionId,
    ).toBe(valid.sourceId);
  });

  it('تاریخ بدون آفست رد می‌شود', () => {
    expect(
      inventoryMovementSchema.safeParse({ ...valid, occurredAt: '2026-02-01T00:00:00' }).success,
    ).toBe(false);
  });
});

describe('inventoryBalanceSchema', () => {
  it('مانده همان قرارداد رشته‌ای مقدار را دارد', () => {
    const parsed = inventoryBalanceSchema.parse({
      itemType: 'COIN',
      itemId: valid.itemId,
      quantity: '12',
    });

    expect(parsed).toEqual({ itemType: 'COIN', itemId: valid.itemId, quantity: '12' });
  });

  it('مانده‌ی منفی در قرارداد ممکن است — سیاستش کار سرور است', () => {
    expect(
      inventoryBalanceSchema.parse({ itemType: 'MELTED_GOLD', itemId: null, quantity: '-5' })
        .quantity,
    ).toBe('-5');
  });
});
