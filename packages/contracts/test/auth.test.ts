import { describe, expect, it } from 'vitest';
import { loginSchema, sessionResponseSchema } from '../src/index.js';

describe('loginSchema — ورودی معتبر', () => {
  it('سه فیلد کامل را می‌پذیرد', () => {
    const parsed = loginSchema.parse({
      email: 'Owner@Example.com',
      password: 'secret1',
      tenantSlug: 'demo',
    });
    expect(parsed).toEqual({ email: 'owner@example.com', password: 'secret1', tenantSlug: 'demo' });
  });

  it('ایمیل را کوچک و trim می‌کند — با ایمیل ذخیره‌شده در بک‌اند هم‌خوان بماند', () => {
    expect(loginSchema.parse({ email: '  A@B.com  ', password: 'x', tenantSlug: 't' }).email).toBe(
      'a@b.com',
    );
  });

  it('رمز عبور trim نمی‌شود — فاصله بخشی از رمز است', () => {
    expect(
      loginSchema.parse({ email: 'a@b.com', password: ' pw ', tenantSlug: 't' }).password,
    ).toBe(' pw ');
  });

  it('حداقل طول رمز عبور هنگام ورود ۱ کاراکتر است، نه سیاست ثبت‌نام', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '1', tenantSlug: 't' }).success).toBe(
      true,
    );
  });
});

describe('loginSchema — ورودی نامعتبر', () => {
  it('ایمیل نامعتبر را رد می‌کند', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x', tenantSlug: 't' }).success).toBe(
      false,
    );
  });

  it('رمز عبور خالی را رد می‌کند', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '', tenantSlug: 't' }).success).toBe(
      false,
    );
  });

  it('tenantSlug خالی یا فقط فاصله را رد می‌کند — همیشه الزامی است', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'x', tenantSlug: '' }).success).toBe(
      false,
    );
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'x', tenantSlug: '   ' }).success).toBe(
      false,
    );
  });
});

describe('sessionResponseSchema', () => {
  const valid = {
    accessToken: 'a.b.c',
    refreshToken: 'r.t.k',
    expiresInSeconds: 900,
    user: { id: 'u1', email: 'owner@example.com', displayName: 'مدیر فروشگاه' },
    tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه' },
    role: 'OWNER',
  };

  it('پاسخ کامل نشست را می‌پذیرد', () => {
    expect(sessionResponseSchema.parse(valid)).toEqual(valid);
  });

  it('فیلد اضافه‌ی حساس (مثلاً passwordHash) را نمی‌پذیرد چون اصلاً تعریف نشده', () => {
    // schema پایه strict نیست، ولی type استنتاج‌شده هرگز چنین فیلدی ندارد —
    // این تست ثابت می‌کند schema حداقل فیلدهای امن را همان‌طور که BE-011 برمی‌گرداند می‌شناسد
    const parsed = sessionResponseSchema.parse({ ...valid, passwordHash: 'leak' });
    expect(parsed).not.toHaveProperty('passwordHash');
  });
});
