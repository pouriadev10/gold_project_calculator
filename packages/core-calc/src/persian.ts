/**
 * نرمال‌سازی متن فارسی.
 *
 * بدون این، جست‌وجوی نام مشتری هرگز درست کار نمی‌کند: «علي» با کاف و
 * یای عربی تایپ می‌شود ولی رکورد با «علی» فارسی ذخیره شده است.
 *
 * قاعده: هنگام **نوشتن در دیتابیس** نرمال‌سازی کن، و کلید جست‌وجو را
 * از `searchKey` بساز — نه از متن خام.
 *
 * همه‌ی الگوها از **کد عددی یونیکد** ساخته می‌شوند، نه از نویسه‌ی خام.
 * نویسه‌های نامرئی (نیم‌فاصله، نشانه‌ی جهت، BOM) در ویرایشگر و در
 * کپی‌وپیست گم یا جابه‌جا می‌شوند و باگ غیرقابل ردیابی می‌سازند.
 */

const cp = (code: number): string => String.fromCodePoint(code);

/** کلاس نویسه‌ای از فهرست کد یونیکد. بازه با آرایه‌ی دوتایی نوشته می‌شود. */
function charClass(codes: readonly (number | readonly [number, number])[]): RegExp {
  const body = codes
    .map((c) => (typeof c === 'number' ? cp(c) : `${cp(c[0])}-${cp(c[1])}`))
    .join('');
  return new RegExp(`[${body}]`, 'gu');
}

/** ي (U+064A) و ى (U+0649) → ی فارسی (U+06CC) */
const YEH = charClass([0x064a, 0x0649]);
const PERSIAN_YEH = cp(0x06cc);

/** ك عربی (U+0643) → ک فارسی (U+06A9) */
const KAF = charClass([0x0643]);
const PERSIAN_KAF = cp(0x06a9);

/** ۀ (U+06C0) · ۂ (U+06C2) · ە (U+06D5) → ه (U+0647) */
const HEH = charClass([0x06c0, 0x06c2, 0x06d5]);
const PERSIAN_HEH = cp(0x0647);

/** کشیده (U+0640) و اعراب (U+064B تا U+0655، و U+0670) */
const TATWEEL_AND_HARAKAT = charClass([0x0640, [0x064b, 0x0655], 0x0670]);

/**
 * نویسه‌های نامرئی: فاصله‌ی صفرعرض (U+200B)، اتصال‌دهنده (U+200D)،
 * نشانه‌های جهت (U+200E–U+200F و U+202A–U+202E) و BOM (U+FEFF).
 *
 * نیم‌فاصله (U+200C) عمداً در این فهرست نیست — بخشی از املای درست است،
 * نه نویسه‌ی زائد. فقط در `searchKey` به فاصله تبدیل می‌شود.
 */
const INVISIBLE = charClass([0x200b, 0x200d, [0x200e, 0x200f], [0x202a, 0x202e], 0xfeff]);

/** نیم‌فاصله (U+200C) */
const ZWNJ = charClass([0x200c]);

const PERSIAN_ZERO = 0x06f0;
const ARABIC_ZERO = 0x0660;
const LATIN_ZERO = 0x30;

/** ارقام فارسی و عربی → ارقام لاتین. مقدار ذخیره‌شده همیشه لاتین است. */
export function toLatinDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) as number;
    if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) {
      out += String(code - PERSIAN_ZERO);
    } else if (code >= ARABIC_ZERO && code <= ARABIC_ZERO + 9) {
      out += String(code - ARABIC_ZERO);
    } else {
      out += ch;
    }
  }
  return out;
}

/** ارقام لاتین → ارقام فارسی. فقط برای نمایش. */
export function toPersianDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) as number;
    if (code >= LATIN_ZERO && code <= LATIN_ZERO + 9) {
      out += cp(PERSIAN_ZERO + (code - LATIN_ZERO));
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * نرمال‌سازی برای **ذخیره**: حروف یکدست، ارقام لاتین، بدون نویسه‌ی نامرئی.
 * نیم‌فاصله حفظ می‌شود.
 */
export function normalizePersian(input: string): string {
  return toLatinDigits(input)
    .replace(INVISIBLE, '')
    .replace(TATWEEL_AND_HARAKAT, '')
    .replace(YEH, PERSIAN_YEH)
    .replace(KAF, PERSIAN_KAF)
    .replace(HEH, PERSIAN_HEH)
    .trim();
}

/**
 * کلید جست‌وجو: نرمال‌سازی + تبدیل نیم‌فاصله به فاصله + یکدست‌کردن فاصله‌ها.
 * «علي رضا» و «علی‌رضا» باید یک کلید بدهند.
 */
export function searchKey(input: string): string {
  return normalizePersian(input)
    .replace(ZWNJ, ' ')
    .replace(/\s+/gu, ' ')
    .toLowerCase()
    .trim();
}

/** آیا `needle` درون `haystack` پیدا می‌شود؟ هر دو نرمال‌سازی می‌شوند. */
export function matchesSearch(haystack: string, needle: string): boolean {
  return searchKey(haystack).includes(searchKey(needle));
}
