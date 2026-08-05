import { describe, expect, it } from 'vitest';
import {
  createJewelryItemSchema,
  jewelryItemDetailQuerySchema,
  jewelryItemListSchema,
  jewelryItemQuerySchema,
  jewelryItemVersionSchema,
  jewelryWageTypeSchema,
  updateJewelryItemSchema,
} from '../src/index.js';

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

/** قرارداد ورودی API — BE-026. */
const validCreate = {
  code: 'RING-001',
  title: 'انگشتر نگین‌دار',
  grossWeightMg: '12000',
  karat: 750,
  wageType: 'PER_GRAM',
  wageValue: '350000',
};

describe('createJewelryItemSchema', () => {
  it('کسورات اختیاری‌اند و پیش‌فرضشان صفر است', () => {
    const parsed = createJewelryItemSchema.parse(validCreate);

    expect(parsed).toMatchObject({ stoneWeightMg: '0', otherDeductionWeightMg: '0' });
    expect(parsed.validFrom).toBeUndefined();
  });

  it('تاریخ شروع اعتبار اختیاری ولی آفست‌دار است', () => {
    expect(
      createJewelryItemSchema.parse({ ...validCreate, validFrom: '2026-01-01T00:00:00Z' })
        .validFrom,
    ).toBe('2026-01-01T00:00:00Z');
    expect(
      createJewelryItemSchema.safeParse({ ...validCreate, validFrom: '2026-01-01T00:00:00' })
        .success,
    ).toBe(false);
  });

  it.each([
    ['کد خالی', { code: '' }],
    ['عنوان خالی', { title: '' }],
    ['وزن اعشاری', { grossWeightMg: '12.5' }],
    ['وزن ناخالص صفر', { grossWeightMg: '0' }],
    ['اجرت منفی', { wageValue: '-1' }],
    ['عیار خارج از بازه', { karat: 0 }],
  ])('ورودی نامعتبر رد می‌شود: %s', (_label, override) => {
    expect(createJewelryItemSchema.safeParse({ ...validCreate, ...override }).success).toBe(false);
  });

  it('فیلد ناشناخته رد می‌شود، نه نادیده گرفته', () => {
    // وگرنه کلاینتی که `pureWeightMg` می‌فرستد بی‌صدا فکر می‌کند
    // سرور آن را پذیرفته است.
    expect(
      createJewelryItemSchema.safeParse({ ...validCreate, pureWeightMg: '7500' }).success,
    ).toBe(false);
  });
});

describe('updateJewelryItemSchema', () => {
  it('تغییر تک‌فیلدی معتبر است', () => {
    expect(updateJewelryItemSchema.parse({ karat: 995 })).toEqual({ karat: 995 });
    expect(updateJewelryItemSchema.parse({ title: 'عنوان تازه' })).toEqual({
      title: 'عنوان تازه',
    });
  });

  it('بدنه‌ی خالی رد می‌شود', () => {
    expect(updateJewelryItemSchema.safeParse({}).success).toBe(false);
  });

  it('کد در بدنه‌ی ویرایش جایی ندارد — هویت کالاست، نه مشخصه‌ی نسخه', () => {
    expect(updateJewelryItemSchema.safeParse({ code: 'RING-002' }).success).toBe(false);
  });

  it('مقدار نامعتبر حتی در حالت جزئی هم رد می‌شود', () => {
    expect(updateJewelryItemSchema.safeParse({ grossWeightMg: '12.5' }).success).toBe(false);
    expect(updateJewelryItemSchema.safeParse({ wageValue: '-1' }).success).toBe(false);
  });
});

describe('jewelryItemQuerySchema', () => {
  it('پیش‌فرض صفحه‌بندی را از قرارداد مشترک می‌گیرد', () => {
    expect(jewelryItemQuerySchema.parse({})).toMatchObject({ limit: 50, offset: 0 });
  });

  it('`active` رشته‌ی صریح است و `"false"` را به `false` تبدیل می‌کند', () => {
    // `z.coerce.boolean()` اینجا فاجعه بود: `Boolean("false") === true`.
    expect(jewelryItemQuerySchema.parse({ active: 'false' }).active).toBe(false);
    expect(jewelryItemQuerySchema.parse({ active: 'true' }).active).toBe(true);
    expect(jewelryItemQuerySchema.safeParse({ active: 'maybe' }).success).toBe(false);
  });

  it('اندازه‌ی صفحه‌ی خارج از بازه رد می‌شود', () => {
    expect(jewelryItemQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
    expect(jewelryItemQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
  });

  it('جست‌وجوی خالی رد می‌شود', () => {
    expect(jewelryItemQuerySchema.safeParse({ search: '' }).success).toBe(false);
  });
});

describe('jewelryItemDetailQuerySchema', () => {
  it('`at` اختیاری و آفست‌دار است', () => {
    expect(jewelryItemDetailQuerySchema.parse({}).at).toBeUndefined();
    expect(jewelryItemDetailQuerySchema.parse({ at: '2026-01-15T00:00:00Z' }).at).toBe(
      '2026-01-15T00:00:00Z',
    );
    expect(jewelryItemDetailQuerySchema.safeParse({ at: '2026-01-15' }).success).toBe(false);
  });
});

describe('jewelryItemListSchema', () => {
  it('پوسته‌ی فهرست همان نسخه‌ها را حمل می‌کند', () => {
    const page = jewelryItemListSchema.parse({ items: [valid], total: 1, limit: 50, offset: 0 });

    expect(page.items[0]).toEqual(valid);
    expect(page.total).toBe(1);
  });
});
