import { describe, expect, it } from 'vitest';
import { apiErrorSchema } from '../src/index.js';

const validError = {
  error: {
    code: 'PARTY_NOT_FOUND',
    message: 'طرف حساب پیدا نشد',
    fields: {},
    requestId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  },
};

describe('apiErrorSchema', () => {
  it('خطای معتبر را می‌پذیرد', () => {
    expect(apiErrorSchema.parse(validError)).toEqual(validError);
  });

  it('در نبود fields، شیء خالی می‌گذارد', () => {
    const { fields: _fields, ...withoutFields } = validError.error;

    expect(apiErrorSchema.parse({ error: withoutFields }).error.fields).toEqual({});
  });

  it('خطای اعتبارسنجی فیلد را نگه می‌دارد', () => {
    const withFields = {
      error: {
        ...validError.error,
        code: 'VALIDATION_FAILED',
        fields: { grossMg: ['وزن نامعتبر'] },
      },
    };

    expect(apiErrorSchema.parse(withFields).error.fields).toEqual({ grossMg: ['وزن نامعتبر'] });
  });

  it.each([
    ['کد با حروف کوچک', { ...validError.error, code: 'party_not_found' }],
    ['کد خالی', { ...validError.error, code: '' }],
    ['پیام خالی', { ...validError.error, message: '' }],
    ['بدون requestId', { code: 'X', message: 'y', fields: {} }],
    ['fields به شکل رشته', { ...validError.error, fields: { name: 'نامعتبر' } }],
  ])('%s را رد می‌کند', (_label, error) => {
    expect(apiErrorSchema.safeParse({ error }).success).toBe(false);
  });

  it('پاسخ بدون پوسته‌ی error را رد می‌کند', () => {
    expect(apiErrorSchema.safeParse(validError.error).success).toBe(false);
  });
});
