import { describe, expect, it } from 'vitest';
import { loginSchema, refreshSchema } from './auth.dto';

const valid = { email: 'a@b.com', password: 'password123', tenantSlug: 'gold-shop' };

describe('loginSchema', () => {
  it('ورودی معتبر را می‌پذیرد', () => {
    expect(loginSchema.parse(valid)).toEqual(valid);
  });

  it('ایمیل را به حروف کوچک تبدیل می‌کند', () => {
    expect(loginSchema.parse({ ...valid, email: 'A@B.COM' }).email).toBe('a@b.com');
  });

  it('فاصله‌ی داخل رمز عبور را دست نمی‌زند', () => {
    // رمز کاربر ممکن است عمداً فاصله داشته باشد؛ trim کردنش یعنی رمزی
    // که ثبت شده با رمزی که فرستاده می‌شود فرق کند.
    const password = '  رمز با فاصله  ';

    expect(loginSchema.parse({ ...valid, password }).password).toBe(password);
  });

  it.each([
    ['ایمیل نامعتبر', { ...valid, email: 'not-an-email' }],
    ['رمز خالی', { ...valid, password: '' }],
    ['بدون tenantSlug', { email: 'a@b.com', password: 'x' }],
    ['tenantSlug خالی', { ...valid, tenantSlug: '   ' }],
  ])('ورودی نامعتبر را رد می‌کند: %s', (_label, input) => {
    expect(loginSchema.safeParse(input).success).toBe(false);
  });

  it('رمز بسیار بلند را رد می‌کند — مسیر DoS روی Argon2', () => {
    expect(loginSchema.safeParse({ ...valid, password: 'a'.repeat(1000) }).success).toBe(false);
  });
});

describe('refreshSchema', () => {
  it('توکن را می‌پذیرد', () => {
    expect(refreshSchema.parse({ refreshToken: 'abc' }).refreshToken).toBe('abc');
  });

  it.each([
    ['خالی', ''],
    ['غایب', undefined],
  ])('توکن %s را رد می‌کند', (_label, refreshToken) => {
    expect(refreshSchema.safeParse({ refreshToken }).success).toBe(false);
  });
});
