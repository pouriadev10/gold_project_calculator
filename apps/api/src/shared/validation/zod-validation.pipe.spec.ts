import { describe, expect, it } from 'vitest';
import { createMixedSettlementSchema, createRialSettlementSchema, updatePartySchema } from '@gold/contracts';
import { z } from 'zod';
import { DEFAULT_VALIDATION_MESSAGE, ZodValidationException, ZodValidationPipe } from './zod-validation.pipe';

function rejection(schema: z.ZodTypeAny, value: unknown): ZodValidationException {
  try {
    new ZodValidationPipe(schema).transform(value);
  } catch (error) {
    if (error instanceof ZodValidationException) return error;
    throw error;
  }
  throw new Error('expected a validation rejection');
}

describe('ZodValidationPipe (M-04)', () => {
  it('ورودی معتبر را با تبدیل‌های schema برمی‌گرداند', () => {
    expect(new ZodValidationPipe(z.object({ n: z.coerce.number() })).transform({ n: '3' })).toEqual({ n: 3 });
  });

  it('پیام‌های پیش‌فرض Zod فارسی‌اند و پیام صریح schema حفظ می‌شود', () => {
    const error = rejection(createRialSettlementSchema, { effectiveAt: 'x' });
    expect(error.fields).toEqual({
      amountRial: ['این فیلد الزامی است'],
      effectiveAt: ['تاریخ و زمان باید ISO-8601 با منطقه‌ی زمانی باشد'],
    });
    expect(error.summary).toBe(DEFAULT_VALIDATION_MESSAGE);
  });

  it('خطای ریشه (کلید ناشناخته در strict) دور ریخته نمی‌شود و پیام پاسخ می‌شود', () => {
    const error = rejection(createRialSettlementSchema, {
      amountRial: '1000',
      effectiveAt: '2026-01-01T00:00:00.000Z',
      payableRial: '1',
    });
    expect(error.fields).toEqual({});
    expect(error.summary).toBe('فیلد ناشناخته: payableRial');
    expect(error.message).toBe('فیلد ناشناخته: payableRial');
  });

  it('refine ِ سطح ریشه (حداقل یک فیلد) پیام خودش را می‌دهد', () => {
    expect(rejection(updatePartySchema, {}).summary).toBe('حداقل یک فیلد برای ویرایش لازم است');
  });

  it('خطای فیلد تودرتو مسیر کامل دارد، نه فقط کلید سطح اول', () => {
    const error = rejection(createMixedSettlementSchema, {
      effectiveAt: '2026-01-01T00:00:00.000Z',
      lines: [
        { type: 'RIAL', amountRial: '1' },
        { type: 'RIAL', amountRial: '-5' },
      ],
    });
    expect(error.fields).toEqual({ 'lines.1.amountRial': ['مقدار باید بزرگ‌تر از صفر باشد'] });
  });

  it('پیام تکراری یک فیلد یک بار می‌آید و مقدار دریافتی هرگز در پاسخ تکرار نمی‌شود', () => {
    const secret = 'my-password-value';
    const schema = z.object({ code: z.string().regex(/^a/u, 'بد').regex(/b$/u, 'بد') });
    const error = rejection(schema, { code: secret });
    expect(error.fields).toEqual({ code: ['بد'] });
    expect(JSON.stringify({ fields: error.fields, summary: error.summary })).not.toContain(secret);
  });
});
