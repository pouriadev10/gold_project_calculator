import { bigIntStringSchema } from '@gold/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseBigIntString } from './bigint';
import { normalizedInput, normalizeTextForSearch, normalizeTextForStorage } from './persian-text';

/**
 * چهار دسته‌ی فیلدی که خود FE-017 نام برده: نام، موبایل، مبلغ، وزن.
 * برای هرکدام ورودی فارسی و لاتین باید نتیجه‌ی یکسان بدهند.
 */

describe('normalizeTextForStorage — نام', () => {
  it('ي عربی و ك عربی را به معادل فارسی یکدست می‌کند', () => {
    expect(normalizeTextForStorage('علي كريمي')).toBe('علی کریمی');
  });

  it('ورودی با حروف عربی و ورودی با حروف فارسی یک نتیجه می‌دهند', () => {
    const arabicForm = normalizeTextForStorage('علي رضا يزداني');
    const persianForm = normalizeTextForStorage('علی رضا یزدانی');
    expect(arabicForm).toBe(persianForm);
  });

  it('فاصله‌ی اضافی را جمع و دو طرف را trim می‌کند', () => {
    expect(normalizeTextForStorage('  علی    رضایی  ')).toBe('علی رضایی');
  });

  it('نیم‌فاصله را حفظ می‌کند — بخشی از املای درست است', () => {
    expect(normalizeTextForStorage('می‌خواهم')).toBe('می‌خواهم');
  });

  it('ارقام فارسی داخل نام هم به لاتین تبدیل می‌شوند', () => {
    expect(normalizeTextForStorage('پلاک ۱۲')).toBe('پلاک 12');
  });
});

describe('normalizeTextForSearch — نام', () => {
  it('دو نوشتار متفاوت یک شخص، یک کلید جست‌وجو می‌دهند', () => {
    expect(normalizeTextForSearch('علي كريمي')).toBe(normalizeTextForSearch('علی کریمی'));
  });
});

describe('normalizeTextForStorage — موبایل', () => {
  it('ارقام فارسی موبایل را به لاتین تبدیل می‌کند، خط‌تیره را نگه می‌دارد', () => {
    // دقیقاً همان نمونه‌ای که apps/api/test/parties-api.e2e-spec.ts (BE-016) برای موبایل تست کرده
    expect(normalizeTextForStorage('۰۹۱۲-۱۲۳-۴۵۶۷')).toBe('0912-123-4567');
  });

  it('موبایل بدون جداساز، فارسی و لاتین یک نتیجه می‌دهند', () => {
    const persian = normalizeTextForStorage('۰۹۱۲۱۲۳۴۵۶۷');
    const latin = normalizeTextForStorage('09121234567');
    expect(persian).toBe(latin);
    expect(persian).toBe('09121234567');
  });

  it('ارقام عربی موبایل هم پذیرفته و یکسان تبدیل می‌شوند', () => {
    expect(normalizeTextForStorage('٠٩١٢١٢٣٤٥٦٧')).toBe('09121234567');
  });
});

describe('parseBigIntString (FE-010) — مبلغ', () => {
  it('مبلغ فارسی و لاتین یک bigint می‌دهند', () => {
    expect(parseBigIntString('۱۲۵۰۰۰۰')).toBe(1250000n);
    expect(parseBigIntString('۱۲۵۰۰۰۰')).toBe(parseBigIntString('1250000'));
  });

  it('مبلغ عربی هم همان نتیجه را می‌دهد', () => {
    expect(parseBigIntString('١٢٥٠٠٠٠')).toBe(1250000n);
  });
});

describe('parseBigIntString (FE-010) — وزن', () => {
  it('وزن میلی‌گرمی فارسی و لاتین یک bigint می‌دهند', () => {
    expect(parseBigIntString('۲۳۵۰۰')).toBe(23500n);
    expect(parseBigIntString('۲۳۵۰۰')).toBe(parseBigIntString('23500'));
  });
});

describe('normalizedInput — نرمال‌سازی پیش از اعتبارسنجی Zod', () => {
  it('مقدار را پیش از رسیدن به schema اصلی نرمال می‌کند', () => {
    const schema = normalizedInput(z.string().min(1));
    expect(schema.parse('  علي   كريمي  ')).toBe('علی کریمی');
  });

  it('برای مبلغ: displayNameSchema نیازی به فکر کردن به ارقام فارسی ندارد — ورودی از قبل لاتین می‌رسد', () => {
    // bigIntStringSchema ارقام فارسی را رد می‌کند (packages/contracts)؛
    // normalizedInput پیش از رسیدن به آن، ارقام را لاتین می‌کند.
    const schema = normalizedInput(bigIntStringSchema);
    expect(schema.parse('۱۲۵۰۰۰۰')).toBe('1250000');
  });

  it('bigIntStringSchema خام بدون normalizedInput ارقام فارسی را رد می‌کند — اثبات اینکه نرمال‌سازی واقعاً کار لایه‌ی ورودی است', () => {
    expect(() => bigIntStringSchema.parse('۱۲۵۰۰۰۰')).toThrow();
  });

  it('بعد از نرمال‌سازی هم قواعد schema اصلی اعمال می‌شود', () => {
    const schema = normalizedInput(z.string().min(1, 'اجباری است'));
    expect(() => schema.parse('   ')).toThrow();
  });

  it('روی مقدار غیررشته‌ای دست نمی‌زند', () => {
    const schema = normalizedInput(z.number());
    expect(schema.parse(42)).toBe(42);
  });
});
