import { describe, expect, it } from 'vitest';
import { createTenantSchema } from './tenant.dto';

const valid = { name: 'طلافروشی نمونه', slug: 'gold-shop' };

describe('createTenantSchema — ورودی معتبر', () => {
  it('نام فارسی و slug لاتین را می‌پذیرد', () => {
    expect(createTenantSchema.parse(valid)).toEqual(valid);
  });

  it('timezone اختیاری است و در نبودش کلید اصلاً ساخته نمی‌شود', () => {
    // مهم است: اگر `undefined` تولید شود، drizzle ستون را در INSERT
    // می‌آورد و DEFAULT دیتابیس دور زده می‌شود.
    expect('timezone' in createTenantSchema.parse(valid)).toBe(false);
  });

  it.each(['Asia/Tehran', 'UTC', 'Europe/Berlin'])('منطقه‌ی زمانی %s را می‌پذیرد', (timezone) => {
    expect(createTenantSchema.parse({ ...valid, timezone }).timezone).toBe(timezone);
  });

  it('فاصله‌ی ابتدا و انتها را حذف می‌کند', () => {
    expect(createTenantSchema.parse({ name: '  طلا  ', slug: '  gold-shop  ' })).toEqual({
      name: 'طلا',
      slug: 'gold-shop',
    });
  });

  it('نام فارسی را با همان قرارداد ذخیره‌سازی یکدست می‌کند', () => {
    const parsed = createTenantSchema.parse({ name: '  طلا  ي  ', slug: 'gold-shop' });

    expect(parsed.name).toBe('طلا ی');
  });
});

describe('createTenantSchema — slug نامعتبر', () => {
  it.each([
    ['Gold-Shop', 'حروف بزرگ'],
    ['gold_shop', 'زیرخط'],
    ['-gold', 'خط تیره‌ی ابتدا'],
    ['gold-', 'خط تیره‌ی انتها'],
    ['gold--shop', 'خط تیره‌ی دوتایی'],
    ['طلا', 'حروف فارسی'],
    ['g', 'کوتاه‌تر از دو کاراکتر'],
    ['', 'خالی'],
    ['gold shop', 'فاصله‌ی میانی'],
  ])('%s را رد می‌کند (%s)', (slug) => {
    expect(createTenantSchema.safeParse({ ...valid, slug }).success).toBe(false);
  });
});

describe('createTenantSchema — سایر خطاها', () => {
  it('نام خالی را رد می‌کند', () => {
    expect(createTenantSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });

  it.each(['Asia/Nowhere', 'not-a-timezone', 'GMT+3:30'])(
    'منطقه‌ی زمانی نامعتبر %s را رد می‌کند',
    (timezone) => {
      expect(createTenantSchema.safeParse({ ...valid, timezone }).success).toBe(false);
    },
  );

  it('فیلد ناشناخته باعث خطا نمی‌شود ولی وارد خروجی هم نمی‌شود', () => {
    const parsed = createTenantSchema.parse({ ...valid, status: 'SUSPENDED' });

    expect(parsed).toEqual(valid);
  });
});
