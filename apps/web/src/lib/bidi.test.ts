import { describe, expect, it } from 'vitest';
import { isolateBidi } from './bidi';

/** FE-083 — جداسازی دوجهته در متن ساده. */

const FSI = String.fromCodePoint(0x2068);
const PDI = String.fromCodePoint(0x2069);

describe('isolateBidi', () => {
  it('wraps Latin codes and Latin digits in FSI…PDI', () => {
    expect(isolateBidi('R-102')).toBe(`${FSI}R-102${PDI}`);
    expect(isolateBidi('7c9e6679')).toBe(`${FSI}7c9e6679${PDI}`);
    expect(isolateBidi('Gold Shop')).toBe(`${FSI}Gold Shop${PDI}`);
  });

  it('leaves all-Persian text (including Persian digits) untouched', () => {
    expect(isolateBidi('زرگری نمونه')).toBe('زرگری نمونه');
    expect(isolateBidi('انگشتر ۱۲')).toBe('انگشتر ۱۲');
    expect(isolateBidi('')).toBe('');
  });
});
