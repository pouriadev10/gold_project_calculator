import { describe, expect, it } from 'vitest';
import { jewelryItemVersionSchema, jewelryWageTypeSchema } from '../src/index.js';

const valid = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  jewelryItemId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
  code: 'RING-001',
  title: 'انگشتر نگین‌دار',
  grossWeightMg: '12000',
  karat: 750,
  stoneWeightMg: '2000',
  otherDeductionWeightMg: '0',
  wageType: 'PER_GRAM',
  wageValue: '350000',
  validFrom: '2026-01-01T00:00:00Z',
  validTo: null,
  version: 1,
  active: true,
};

describe('jewelryItemVersionSchema — ورودی معتبر', () => {
  it('نسخه‌ی کامل را می‌پذیرد', () => {
    expect(jewelryItemVersionSchema.parse(valid)).toEqual(valid);
  });

  it('کسورات صفر معتبر است', () => {
    const parsed = jewelryItemVersionSchema.parse({
      ...valid,
      stoneWeightMg: '0',
      otherDeductionWeightMg: '0',
    });

    expect(parsed.stoneWeightMg).toBe('0');
  });

  it.each(['PER_GRAM', 'PERCENT_X100', 'FLAT'])('نوع اجرت %s را می‌پذیرد', (wageType) => {
    expect(jewelryItemVersionSchema.parse({ ...valid, wageType }).wageType).toBe(wageType);
  });

  it('وزن بزرگ‌تر از محدوده‌ی امن number بدون از دست دادن رقم عبور می‌کند', () => {
    const huge = '9007199254740993';

    expect(jewelryItemVersionSchema.parse({ ...valid, grossWeightMg: huge }).grossWeightMg).toBe(
      huge,
    );
  });
});

/**
 * معیار پذیرش BE-025: «مقدار اعشاری وزن در API رد شود».
 *
 * رد می‌شود، نه گرد: `"12.5"` یعنی کلاینت گرم فرستاده به‌جای میلی‌گرم و
 * پذیرفتنِ گردشده وزن را ۱۰۰۰ برابر غلط می‌کرد.
 */
describe('jewelryItemVersionSchema — وزن اعشاری رد می‌شود', () => {
  it.each([
    ['grossWeightMg', '12.5'],
    ['stoneWeightMg', '2.5'],
    ['otherDeductionWeightMg', '0.1'],
    ['wageValue', '350000.75'],
  ])('%s با مقدار اعشاری %s رد می‌شود', (field, value) => {
    expect(jewelryItemVersionSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
  });

  it('وزن به‌صورت number — نه رشته — رد می‌شود', () => {
    expect(jewelryItemVersionSchema.safeParse({ ...valid, grossWeightMg: 12000 }).success).toBe(
      false,
    );
  });

  it.each([
    ['ارقام فارسی', '۱۲۰۰۰'],
    ['جداکننده‌ی هزارگان', '12,000'],
    ['نماد علمی', '1.2e4'],
    ['صفر ابتدایی', '012000'],
    ['خالی', ''],
  ])('وزن نامعتبر رد می‌شود: %s', (_label, grossWeightMg) => {
    expect(jewelryItemVersionSchema.safeParse({ ...valid, grossWeightMg }).success).toBe(false);
  });
});

describe('jewelryItemVersionSchema — سایر قواعد', () => {
  it('وزن ناخالص صفر رد می‌شود', () => {
    expect(jewelryItemVersionSchema.safeParse({ ...valid, grossWeightMg: '0' }).success).toBe(
      false,
    );
  });

  it('وزن منفی رد می‌شود', () => {
    expect(jewelryItemVersionSchema.safeParse({ ...valid, stoneWeightMg: '-1' }).success).toBe(
      false,
    );
  });

  it.each([0, 1001, 7.5, -750])('عیار نامعتبر %s رد می‌شود', (karat) => {
    expect(jewelryItemVersionSchema.safeParse({ ...valid, karat }).success).toBe(false);
  });

  it.each([1, 750, 1000])('عیار معتبر %s پذیرفته می‌شود', (karat) => {
    expect(jewelryItemVersionSchema.parse({ ...valid, karat }).karat).toBe(karat);
  });

  it('نوع اجرت ناشناخته رد می‌شود', () => {
    expect(jewelryItemVersionSchema.safeParse({ ...valid, wageType: 'HOURLY' }).success).toBe(
      false,
    );
  });

  it('تاریخ بدون آفست رد می‌شود', () => {
    expect(
      jewelryItemVersionSchema.safeParse({ ...valid, validFrom: '2026-01-01T00:00:00' }).success,
    ).toBe(false);
  });

  it('وزن خالص عمداً بخشی از قرارداد نیست', () => {
    // مشتق سه فیلد دیگر و عیار است؛ فرستادنش روی سیم یعنی کلاینت بتواند
    // مقداری ناسازگار با اجزایش بدهد.
    expect(Object.keys(jewelryItemVersionSchema.shape)).not.toContain('pureWeightMg');
  });
});

describe('jewelryWageTypeSchema', () => {
  it('فقط سه نوع فاز ۱ را می‌شناسد', () => {
    expect(jewelryWageTypeSchema.options).toEqual(['PER_GRAM', 'PERCENT_X100', 'FLAT']);
  });
});
