import { describe, expect, it } from 'vitest';
import { isoDateTimeSchema } from '../src/index.js';

describe('isoDateTimeSchema', () => {
  it.each(['2026-03-21T00:30:00Z', '2026-03-21T00:30:00.000Z', '2026-03-21T04:00:00+03:30'])(
    'زمان آفست‌دار %s را می‌پذیرد',
    (value) => {
      expect(isoDateTimeSchema.parse(value)).toBe(value);
    },
  );

  it.each([
    ['2026-03-21T00:30:00', 'بدون آفست — همین ابهام فاکتور را در روز اشتباه می‌نشاند'],
    ['2026-03-21', 'فقط تاریخ'],
    ['۱۴۰۵-۰۱-۰۱T۰۰:۳۰:۰۰Z', 'ارقام فارسی'],
    ['1405/01/01', 'تاریخ جلالی — تبدیل کار لایه‌ی نمایش است'],
    ['', 'خالی'],
  ])('مقدار نامعتبر %s را رد می‌کند (%s)', (value) => {
    expect(isoDateTimeSchema.safeParse(value).success).toBe(false);
  });
});
