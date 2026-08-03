import { bigIntStringSchema, isoDateTimeSchema, uuidSchema } from '@gold/contracts';
import { describe, expect, it } from 'vitest';

/**
 * اثبات اینکه `@gold/contracts` از داخل فرانت‌اند هم قابل import است.
 *
 * فرانت و بک‌اند باید **یک** تعریف از «مبلغ معتبر» داشته باشند؛ اگر فرم
 * مرورگر چیزی را بپذیرد که سرور رد می‌کند، کاربر خطای گیج‌کننده می‌گیرد.
 */
describe('@gold/contracts از فرانت‌اند', () => {
  it('همان قواعد رشته‌ی صحیح را اعمال می‌کند', () => {
    expect(bigIntStringSchema.parse('12500000')).toBe('12500000');
    expect(bigIntStringSchema.safeParse('12.5').success).toBe(false);
    expect(bigIntStringSchema.safeParse('۱۲۳').success).toBe(false);
  });

  it('schemaهای پایه در مرورگر هم کار می‌کنند', () => {
    expect(uuidSchema.safeParse('3f2504e0-4f89-41d3-9a0c-0305e82c3301').success).toBe(true);
    expect(isoDateTimeSchema.safeParse('2026-03-21T04:00:00+03:30').success).toBe(true);
  });
});
