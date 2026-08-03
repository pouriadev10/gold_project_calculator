import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  paginatedSchema,
  paginationQuerySchema,
} from '../src/index.js';

describe('paginationQuerySchema', () => {
  it('در نبود پارامتر، مقدار پیش‌فرض می‌گذارد', () => {
    expect(paginationQuerySchema.parse({})).toEqual({
      limit: DEFAULT_PAGE_SIZE,
      offset: 0,
    });
  });

  it('رشته‌ی query string را به عدد تبدیل می‌کند', () => {
    expect(paginationQuerySchema.parse({ limit: '25', offset: '100' })).toEqual({
      limit: 25,
      offset: 100,
    });
  });

  it.each([
    ['limit صفر', { limit: '0' }],
    ['limit منفی', { limit: '-1' }],
    ['limit بزرگ‌تر از سقف', { limit: String(MAX_PAGE_SIZE + 1) }],
    ['limit اعشاری', { limit: '10.5' }],
    ['offset منفی', { offset: '-1' }],
    ['limit غیرعددی', { limit: 'abc' }],
  ])('%s را رد می‌کند', (_label, value) => {
    expect(paginationQuerySchema.safeParse(value).success).toBe(false);
  });
});

describe('paginatedSchema', () => {
  const schema = paginatedSchema(z.object({ id: z.string() }));

  it('پاسخ فهرستی معتبر را می‌پذیرد', () => {
    const page = { items: [{ id: 'a' }], total: 1, limit: 50, offset: 0 };

    expect(schema.parse(page)).toEqual(page);
  });

  it('فهرست خالی معتبر است', () => {
    expect(schema.safeParse({ items: [], total: 0, limit: 50, offset: 0 }).success).toBe(true);
  });

  it('total منفی را رد می‌کند', () => {
    expect(schema.safeParse({ items: [], total: -1, limit: 50, offset: 0 }).success).toBe(false);
  });

  it('نبود total را رد می‌کند', () => {
    expect(schema.safeParse({ items: [], limit: 50, offset: 0 }).success).toBe(false);
  });
});
