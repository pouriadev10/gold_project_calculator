import { bigIntStringSchema, paginationQuerySchema, DEFAULT_PAGE_SIZE } from '@gold/contracts';
import { describe, expect, it } from 'vitest';

/**
 * اثبات اینکه `@gold/contracts` از داخل بک‌اند قابل import است و همان
 * schemaای که فرانت‌اند می‌بیند اینجا هم اجرا می‌شود.
 *
 * مسیر runtime بک‌اند (CommonJS، `node dist/main.js`) شرط `require` را در
 * exports می‌گیرد و به `dist/` می‌رسد؛ همین تست از مسیر ESM می‌آید و به
 * `src/`. هر دو باید یک رفتار بدهند.
 */
describe('@gold/contracts از بک‌اند', () => {
  it('schema رشته‌ی صحیح را import و اجرا می‌کند', () => {
    expect(bigIntStringSchema.parse('12500000')).toBe('12500000');
    expect(bigIntStringSchema.safeParse('12.5').success).toBe(false);
    expect(bigIntStringSchema.safeParse('۱۲۳').success).toBe(false);
  });

  it('پیش‌فرض‌های صفحه‌بندی از همان قرارداد مشترک می‌آیند', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
  });
});
