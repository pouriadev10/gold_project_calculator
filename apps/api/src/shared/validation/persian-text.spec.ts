import { describe, expect, it } from 'vitest';
import { likeContainsPattern, normalizeTextForSearch, normalizeTextForStorage } from './persian-text';

describe('persian-text (M-04)', () => {
  it('ذخیره و جست‌وجو همان قرارداد core-calc را دارند', () => {
    expect(normalizeTextForStorage('  علي   رضا ۱۲ ')).toBe('علی رضا 12');
    expect(normalizeTextForSearch('علی‌رضا')).toBe(normalizeTextForSearch('علي رضا'));
  });

  it('الگوی LIKE ِ «شامل» wildcardهای ورودی را خنثی می‌کند', () => {
    expect(likeContainsPattern('علی')).toBe('%علی%');
    expect(likeContainsPattern('۱۰۰%')).toBe(String.raw`%۱۰۰\%%`);
    expect(likeContainsPattern('a_b')).toBe(String.raw`%a\_b%`);
    expect(likeContainsPattern(String.raw`c:\path`)).toBe(String.raw`%c:\\path%`);
    expect(likeContainsPattern('')).toBe('%%');
  });
});
