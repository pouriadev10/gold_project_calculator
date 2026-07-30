import { describe, expect, it } from 'vitest';
import {
  matchesSearch,
  normalizePersian,
  searchKey,
  toLatinDigits,
  toPersianDigits,
} from '../src/persian.js';

const cp = (code: number): string => String.fromCodePoint(code);

const ARABIC_YEH = cp(0x064a);
const ALEF_MAKSURA = cp(0x0649);
const PERSIAN_YEH = cp(0x06cc);
const ARABIC_KAF = cp(0x0643);
const PERSIAN_KAF = cp(0x06a9);
const ZWNJ = cp(0x200c);
const ZWSP = cp(0x200b);
const BOM = cp(0xfeff);
const RLM = cp(0x200f);
const TATWEEL = cp(0x0640);
const FATHA = cp(0x064b);

describe('ارقام', () => {
  it('ارقام فارسی به لاتین تبدیل می‌شوند', () => {
    expect(toLatinDigits('۱۲۳۴۵۶۷۸۹۰')).toBe('1234567890');
  });

  it('ارقام عربی به لاتین تبدیل می‌شوند', () => {
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('نویسه‌های غیررقمی دست‌نخورده می‌مانند', () => {
    expect(toLatinDigits('کد ۱۲ الف')).toBe('کد 12 الف');
  });

  it('لاتین به فارسی برمی‌گردد — فقط برای نمایش', () => {
    expect(toPersianDigits('1234567890')).toBe('۱۲۳۴۵۶۷۸۹۰');
    expect(toPersianDigits('a1b')).toBe('a۱b');
  });
});

describe('یکدست‌سازی حروف', () => {
  it('یای عربی به یای فارسی تبدیل می‌شود', () => {
    expect(normalizePersian(`عل${ARABIC_YEH}`)).toBe(`عل${PERSIAN_YEH}`);
  });

  it('الف مقصوره هم به یای فارسی تبدیل می‌شود', () => {
    expect(normalizePersian(`مصطف${ALEF_MAKSURA}`)).toBe(`مصطف${PERSIAN_YEH}`);
  });

  it('کاف عربی به کاف فارسی تبدیل می‌شود', () => {
    expect(normalizePersian(`${ARABIC_KAF}رم`)).toBe(`${PERSIAN_KAF}رم`);
  });

  it('هه‌ی همزه‌دار ساده می‌شود', () => {
    expect(normalizePersian(cp(0x06c0))).toBe(cp(0x0647));
    expect(normalizePersian(cp(0x06c2))).toBe(cp(0x0647));
    expect(normalizePersian(cp(0x06d5))).toBe(cp(0x0647));
  });

  it('کشیده و اعراب حذف می‌شوند', () => {
    expect(normalizePersian(`سلا${TATWEEL}م`)).toBe('سلام');
    expect(normalizePersian(`سَلام${FATHA}`)).toBe('سلام');
    expect(normalizePersian(cp(0x0670))).toBe('');
  });

  it('نویسه‌های نامرئی حذف می‌شوند', () => {
    expect(normalizePersian(`علی${ZWSP}${BOM}${RLM}`)).toBe('علی');
    expect(normalizePersian(cp(0x202a) + 'الف' + cp(0x202c))).toBe('الف');
  });

  it('نیم‌فاصله حفظ می‌شود — بخشی از املای درست است', () => {
    expect(normalizePersian(`علی${ZWNJ}رضا`)).toBe(`علی${ZWNJ}رضا`);
  });

  it('فاصله‌ی ابتدا و انتها حذف می‌شود', () => {
    expect(normalizePersian('  علی  ')).toBe('علی');
  });
});

describe('کلید جست‌وجو', () => {
  it('«علي» با یای عربی همان کلید «علی» را می‌دهد', () => {
    expect(searchKey(`عل${ARABIC_YEH}`)).toBe(searchKey(`عل${PERSIAN_YEH}`));
  });

  it('نیم‌فاصله و فاصله یکی شمرده می‌شوند', () => {
    expect(searchKey(`علی${ZWNJ}رضا`)).toBe(searchKey('علی رضا'));
  });

  it('فاصله‌های پشت‌سرهم جمع می‌شوند', () => {
    expect(searchKey('علی    رضا')).toBe('علی رضا');
  });

  it('حروف لاتین کوچک می‌شوند', () => {
    expect(searchKey('ABC')).toBe('abc');
  });
});

describe('matchesSearch — سناریوی واقعی صندوق', () => {
  it('جست‌وجوی «علي» رکورد «علی» را پیدا می‌کند', () => {
    expect(matchesSearch(`عل${PERSIAN_YEH} رضا${PERSIAN_YEH}`, `عل${ARABIC_YEH}`)).toBe(true);
  });

  it('جست‌وجو با کاف عربی رکورد فارسی را پیدا می‌کند', () => {
    expect(matchesSearch(`${PERSIAN_KAF}ریمی`, `${ARABIC_KAF}ریمی`)).toBe(true);
  });

  it('جست‌وجو با ارقام فارسی رکورد لاتین را پیدا می‌کند', () => {
    expect(matchesSearch('کد 1234', 'کد ۱۲۳۴')).toBe(true);
  });

  it('نام بی‌ربط پیدا نمی‌شود', () => {
    expect(matchesSearch('علی رضایی', 'محمد')).toBe(false);
  });
});
