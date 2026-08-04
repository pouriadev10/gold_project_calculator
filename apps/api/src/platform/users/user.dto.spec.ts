import { describe, expect, it } from 'vitest';
import { addMembershipSchema, createUserSchema } from './user.dto';

const USER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('createUserSchema', () => {
  it('ایمیل را به حروف کوچک تبدیل می‌کند', () => {
    // بدون این، «Ali@X.com» و «ali@x.com» دو حساب جدا می‌ساختند.
    const parsed = createUserSchema.parse({ email: 'Ali@X.COM', displayName: 'علی' });

    expect(parsed.email).toBe('ali@x.com');
  });

  it('فاصله‌ی ابتدا و انتها را حذف می‌کند', () => {
    const parsed = createUserSchema.parse({ email: '  a@b.com  ', displayName: '  علی  ' });

    expect(parsed).toEqual({ email: 'a@b.com', displayName: 'علی' });
  });

  it.each([
    ['بدون @', 'not-an-email'],
    ['بدون دامنه', 'a@'],
    ['خالی', ''],
    ['فقط فاصله', '   '],
  ])('ایمیل نامعتبر را رد می‌کند: %s', (_label, email) => {
    expect(createUserSchema.safeParse({ email, displayName: 'x' }).success).toBe(false);
  });

  it('نام نمایشی خالی را رد می‌کند', () => {
    expect(createUserSchema.safeParse({ email: 'a@b.com', displayName: '  ' }).success).toBe(false);
  });
});

describe('addMembershipSchema', () => {
  it.each(['OWNER', 'MANAGER', 'CASHIER'])('نقش فاز ۱ را می‌پذیرد: %s', (roleCode) => {
    expect(addMembershipSchema.parse({ userId: USER_ID, roleCode }).roleCode).toBe(roleCode);
  });

  it.each([
    ['نقش ناشناخته', 'ADMIN'],
    ['حروف کوچک', 'owner'],
    ['خالی', ''],
  ])('نقش نامعتبر را رد می‌کند: %s', (_label, roleCode) => {
    expect(addMembershipSchema.safeParse({ userId: USER_ID, roleCode }).success).toBe(false);
  });

  it('شناسه‌ی کاربر باید UUID باشد', () => {
    expect(addMembershipSchema.safeParse({ userId: 'nope', roleCode: 'OWNER' }).success).toBe(
      false,
    );
  });
});
