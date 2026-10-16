import { describe, expect, it } from 'vitest';
import { documentQuoteRate } from './document-rate';

const QUOTE = { quoteId: 'q-1', gram1000: 147_741_000n };

describe('documentQuoteRate (FE-104)', () => {
  it('نرخ همان مظنه‌ای که سند با آن ثبت شد', () => {
    expect(documentQuoteRate('q-1', QUOTE)).toBe(147_741_000n);
  });

  it('مظنه‌ی دیگر (مثلاً مظنه‌ی امروز پس از تغییر) نرخ سند نیست', () => {
    expect(documentQuoteRate('q-0', QUOTE)).toBeNull();
  });

  it('سند بدون مظنه یا مظنه‌ی نامعلوم ← بدون نرخ', () => {
    expect(documentQuoteRate(null, QUOTE)).toBeNull();
    expect(documentQuoteRate(undefined, QUOTE)).toBeNull();
    expect(documentQuoteRate('q-1', null)).toBeNull();
    expect(documentQuoteRate('q-1', undefined)).toBeNull();
  });
});
