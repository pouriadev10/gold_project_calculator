import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createCoinSaleSchema,
  createRialSettlementSchema,
  persianZodErrorMap,
  updatePartySchema,
} from '../src/index.js';

const LATIN_LETTERS = /[A-Za-z]{3,}/u;

function messages(schema: z.ZodTypeAny, value: unknown): string[] {
  const result = schema.safeParse(value, { errorMap: persianZodErrorMap });
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('persianZodErrorMap', () => {
  it('فیلد ناموجود، تاریخ بدشکل و نوع غلط پیام فارسی می‌گیرند', () => {
    expect(messages(createRialSettlementSchema, { effectiveAt: 'x' })).toEqual([
      'این فیلد الزامی است',
      'تاریخ و زمان باید ISO-8601 با منطقه‌ی زمانی باشد',
    ]);
    expect(messages(z.object({ count: z.number() }), { count: '3' })).toEqual(['نوع مقدار نادرست است']);
  });

  it('کلید ناشناخته در شیء strict نامش را با پیام فارسی می‌گوید', () => {
    expect(messages(z.object({}).strict(), { payableRial: '1', extra: 2 })).toEqual([
      'فیلد ناشناخته: payableRial، extra',
    ]);
  });

  it('نام کلیدهای ناشناخته‌ی ورودی محدود بازتاب می‌شود', () => {
    const many = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`k${index}`, 1]));
    expect(messages(z.object({}).strict(), many)).toEqual(['فیلد ناشناخته: k0، k1، k2، k3، k4 و …']);
    expect(messages(z.object({}).strict(), { ['x'.repeat(100)]: 1 })).toEqual([
      `فیلد ناشناخته: ${'x'.repeat(40)}…`,
    ]);
  });

  it('پیام صریح schema را دست نمی‌زند', () => {
    expect(messages(updatePartySchema, {})).toEqual(['حداقل یک فیلد برای ویرایش لازم است']);
    expect(messages(createCoinSaleSchema.shape.partyId, 'x')).toEqual(['شناسه باید UUID معتبر باشد']);
  });

  it('کران‌ها با ارقام فارسی و جهت درست', () => {
    expect(messages(z.string().min(3), 'ab')).toEqual(['حداقل ۳ نویسه لازم است']);
    expect(messages(z.string().max(2), 'abc')).toEqual(['حداکثر ۲ نویسه مجاز است']);
    expect(messages(z.array(z.number()).min(1), [])).toEqual(['حداقل ۱ مورد لازم است']);
    expect(messages(z.array(z.number()).max(1), [1, 2])).toEqual(['حداکثر ۱ مورد مجاز است']);
    expect(messages(z.number().min(5), 4)).toEqual(['باید حداقل ۵ باشد']);
    expect(messages(z.number().positive(), 0)).toEqual(['باید بزرگ‌تر از ۰ باشد']);
    expect(messages(z.number().max(10), 11)).toEqual(['باید حداکثر ۱۰ باشد']);
    expect(messages(z.number().lt(10), 10)).toEqual(['باید کوچک‌تر از ۱۰ باشد']);
  });

  it('enum، discriminator، literal و بقیه‌ی کدها فارسی‌اند', () => {
    expect(messages(z.enum(['A', 'B']), 'C')).toEqual(['مقدار مجاز نیست؛ یکی از این‌ها باشد: A، B']);
    const union = z.discriminatedUnion('type', [
      z.object({ type: z.literal('RIAL') }),
      z.object({ type: z.literal('GOLD') }),
    ]);
    expect(messages(union, { type: 'X' })).toEqual(['نوع نامعتبر است؛ یکی از این‌ها باشد: RIAL، GOLD']);
    expect(messages(z.literal('X'), 'Y')).toEqual(['مقدار مجاز نیست']);
    expect(messages(z.number().multipleOf(5), 7)).toEqual(['باید مضربی از ۵ باشد']);
    expect(messages(z.number().finite(), Number.POSITIVE_INFINITY)).toEqual(['عدد باید متناهی باشد']);
    expect(messages(z.date(), new Date('invalid'))).toEqual(['تاریخ نامعتبر است']);
    expect(messages(z.string().email(), 'x')).toEqual(['ایمیل معتبر نیست']);
    expect(messages(z.string().regex(/^a$/u), 'b')).toEqual(['قالب مقدار نادرست است']);
    expect(messages(z.string().startsWith('a'), 'b')).toEqual(['قالب مقدار نادرست است']);
    expect(messages(z.number().int(), 1.5)).toEqual(['نوع مقدار نادرست است']);
    expect(messages(z.union([z.string(), z.number()]), true)).toEqual(['مقدار نامعتبر است']);
  });

  it('هیچ پیام پیش‌فرضی انگلیسی نمی‌ماند', () => {
    const all = [
      ...messages(createRialSettlementSchema, {}),
      // کلید ناشناخته عمداً نام خودش را می‌گوید (بالاتر آزموده شده)؛ اینجا فقط پیام‌های پیش‌فرض.
      ...messages(createCoinSaleSchema, { count: '3' }),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const message of all) expect(message).not.toMatch(LATIN_LETTERS);
  });
});
