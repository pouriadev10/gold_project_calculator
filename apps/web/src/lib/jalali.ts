import { toPersianDigits } from '@gold/core-calc';

/**
 * تقویم شمسی و مرز روز در منطقه‌ی زمانی مستأجر — FE-071.
 *
 * تبدیل جلالی↔میلادی همان الگوریتم حسابی شناخته‌شده‌ی jalaali-js (MIT،
 * جدول سال‌های شکست ۳۳ساله) است، بدون کتابخانه: `date-fns-jalali` عمداً
 * وارد بسته‌ی production نمی‌شود (توضیح در `lib/date.ts`). همه‌چیز با
 * عدد صحیح است؛ `Math.floor` در این پروژه ممنوع است، پس تقسیم صحیح با
 * `div`/`mod` پایین انجام می‌شود.
 *
 * «روز» همیشه شماره‌ی روز ژولینی (JDN) است — یک عدد صحیح بی‌منطقه. فقط
 * هنگام تبدیل به لحظه‌ی واقعی (`Date`/ISO) منطقه‌ی زمانی وارد می‌شود، و آن
 * منطقه همیشه منطقه‌ی مستأجر است، نه منطقه‌ی دستگاه کاربر.
 */

export interface JalaliDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface JalaliDateRange {
  readonly from: JalaliDate | null;
  readonly to: JalaliDate | null;
}

export const EMPTY_JALALI_RANGE: JalaliDateRange = { from: null, to: null };

export const JALALI_MONTH_NAMES = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
] as const;

/** ترتیب روزهای هفته‌ی ایرانی؛ هفته از شنبه شروع می‌شود. */
export const JALALI_WEEKDAY_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'] as const;

const DAY_MS = 86_400_000;
/** JDN روز ۱۹۷۰-۰۱-۰۱ — مبدأ زمان یونیکس. */
const UNIX_EPOCH_DAY = 2_440_588;

/** محدوده‌ی پشتیبانی‌شده‌ی جدول شکست‌ها. */
const MIN_JALALI_YEAR = 1;
const MAX_JALALI_YEAR = 3177;

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394,
  2456, 3178,
] as const;

/** تقسیم صحیح با گرد شدن به سمت صفر — هم‌ارز `~~(a / b)` در jalaali-js. */
function div(a: number, b: number): number {
  return (a - (a % b)) / b;
}

/** باقی‌مانده هم‌علامت با مقسوم — هم‌ارز `a - ~~(a / b) * b`. */
function mod(a: number, b: number): number {
  return a % b;
}

/** باقی‌مانده‌ی همیشه نامنفی، برای JDN و میلی‌ثانیه. */
function positiveMod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

interface JalaliYearInfo {
  readonly leap: number;
  readonly gy: number;
  readonly march: number;
}

function jalCal(jy: number): JalaliYearInfo {
  const gy = jy + 621;
  let leapJ = -14;
  let jp: number = BREAKS[0];
  let jump = 0;

  for (let i = 1; i < BREAKS.length; i += 1) {
    const jm = BREAKS[i]!;
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }

  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;

  return { leap, gy, march };
}

/** شماره‌ی روز ژولینی یک تاریخ میلادی (ماه ۱ تا ۱۲). */
export function gregorianToDayNumber(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100_100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34_840_408;
  d = d - div(div(gy + 100_100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

export function dayNumberToGregorian(jdn: number): { year: number; month: number; day: number } {
  let j = 4 * jdn + 139_361_631;
  j = j + div(div(4 * jdn + 183_187_720, 146_097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const day = div(mod(i, 153), 5) + 1;
  const month = mod(div(i, 153), 12) + 1;
  const year = div(j, 1461) - 100_100 + div(8 - month, 6);
  return { year, month, day };
}

export function isJalaliLeapYear(year: number): boolean {
  return jalCal(year).leap === 0;
}

export function jalaliMonthLength(year: number, month: number): number {
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  return isJalaliLeapYear(year) ? 30 : 29;
}

export function isValidJalaliDate(date: JalaliDate): boolean {
  const { year, month, day } = date;
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    year >= MIN_JALALI_YEAR &&
    year <= MAX_JALALI_YEAR &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= jalaliMonthLength(year, month)
  );
}

function assertValid(date: JalaliDate): void {
  if (!isValidJalaliDate(date)) {
    throw new RangeError(`تاریخ شمسی نامعتبر: ${date.year}/${date.month}/${date.day}`);
  }
}

export function jalaliToDayNumber(date: JalaliDate): number {
  assertValid(date);
  const { gy, march } = jalCal(date.year);
  return (
    gregorianToDayNumber(gy, 3, march) +
    (date.month - 1) * 31 -
    div(date.month, 7) * (date.month - 7) +
    date.day -
    1
  );
}

export function dayNumberToJalali(jdn: number): JalaliDate {
  const gy = dayNumberToGregorian(jdn).year;
  let year = gy - 621;
  const info = jalCal(year);
  let k = jdn - gregorianToDayNumber(gy, 3, info.march);

  if (k >= 0) {
    if (k <= 185) {
      return { year, month: 1 + div(k, 31), day: mod(k, 31) + 1 };
    }
    k -= 186;
  } else {
    year -= 1;
    k += 179;
    if (info.leap === 1) k += 1;
  }
  return { year, month: 7 + div(k, 30), day: mod(k, 30) + 1 };
}

export function compareJalali(a: JalaliDate, b: JalaliDate): number {
  return jalaliToDayNumber(a) - jalaliToDayNumber(b);
}

export function addJalaliDays(date: JalaliDate, days: number): JalaliDate {
  return dayNumberToJalali(jalaliToDayNumber(date) + days);
}

/** ۰ = شنبه … ۶ = جمعه. */
export function jalaliWeekdayIndex(date: JalaliDate): number {
  return positiveMod(jalaliToDayNumber(date) + 2, 7);
}

/** «۱۸ مهر ۱۴۰۵» */
export function formatJalaliDate(date: JalaliDate): string {
  return `${toPersianDigits(String(date.day))} ${JALALI_MONTH_NAMES[date.month - 1]} ${toPersianDigits(String(date.year))}`;
}

/** «مهر ۱۴۰۵» */
export function formatJalaliMonth(year: number, month: number): string {
  return `${JALALI_MONTH_NAMES[month - 1]} ${toPersianDigits(String(year))}`;
}

/* ── منطقه‌ی زمانی ─────────────────────────────────────────── */

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** آیا `Intl` این نام IANA را می‌شناسد؟ */
export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') return false;
  try {
    wallClockFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  readonly dayNumber: number;
  /** میلی‌ثانیه از نیمه‌شب محلی، بدون بخش زیرثانیه. */
  readonly msOfDay: number;
}

function wallClock(instantMs: number, timeZone: string): WallClock {
  const parts = wallClockFormatter(timeZone).formatToParts(new Date(instantMs));
  const pick = (type: Intl.DateTimeFormatPartTypes): number =>
    Number.parseInt(parts.find((part) => part.type === type)?.value ?? '0', 10);
  // برخی موتورها نیمه‌شب را حتی با h23 «۲۴» گزارش می‌کنند.
  const hour = pick('hour') % 24;
  return {
    dayNumber: gregorianToDayNumber(pick('year'), pick('month'), pick('day')),
    msOfDay: ((hour * 60 + pick('minute')) * 60 + pick('second')) * 1000,
  };
}

/** اختلاف ساعت محلی منطقه با UTC در یک لحظه، به میلی‌ثانیه. */
function offsetAt(instantMs: number, timeZone: string): number {
  const wholeSecond = instantMs - positiveMod(instantMs, 1000);
  const local = wallClock(wholeSecond, timeZone);
  return (local.dayNumber - UNIX_EPOCH_DAY) * DAY_MS + local.msOfDay - wholeSecond;
}

/**
 * لحظه‌ی واقعی نیمه‌شب آغاز یک روز شمسی در منطقه‌ی مستأجر. دو گذر لازم
 * است چون اختلاف ساعت خودش به لحظه بستگی دارد (ساعت تابستانی، از جمله
 * سال‌هایی که ایران آن را داشت).
 */
export function startOfJalaliDay(date: JalaliDate, timeZone: string): Date {
  const wallMidnight = (jalaliToDayNumber(date) - UNIX_EPOCH_DAY) * DAY_MS;
  const firstGuess = wallMidnight - offsetAt(wallMidnight, timeZone);
  const corrected = wallMidnight - offsetAt(firstGuess, timeZone);
  return new Date(corrected);
}

/** آخرین میلی‌ثانیه‌ی همان روز — یعنی یک میلی‌ثانیه پیش از آغاز روز بعد. */
export function endOfJalaliDay(date: JalaliDate, timeZone: string): Date {
  return new Date(startOfJalaliDay(addJalaliDays(date, 1), timeZone).getTime() - 1);
}

/** امروزِ شمسی در منطقه‌ی مستأجر — نه در منطقه‌ی دستگاه. */
export function jalaliToday(timeZone: string, now: Date = new Date()): JalaliDate {
  return dayNumberToJalali(wallClock(now.getTime(), timeZone).dayNumber);
}

export function isInvertedRange(range: JalaliDateRange): boolean {
  return range.from !== null && range.to !== null && compareJalali(range.from, range.to) > 0;
}

/**
 * بازه‌ی شمسی → مرزهای ISO قرارداد API (`isoDateTimeSchema`): `from`
 * نیمه‌شب آغاز روز اول، `to` آخرین میلی‌ثانیه‌ی روز آخر، هر دو در منطقه‌ی
 * مستأجر و هر دو شامل. بازه‌ی وارونه `null` است تا صفحه درخواست نسازد.
 */
export function jalaliRangeToIso(
  range: JalaliDateRange,
  timeZone: string,
): { from?: string; to?: string } | null {
  if (isInvertedRange(range)) return null;
  return {
    ...(range.from ? { from: startOfJalaliDay(range.from, timeZone).toISOString() } : {}),
    ...(range.to ? { to: endOfJalaliDay(range.to, timeZone).toISOString() } : {}),
  };
}

export type JalaliRangePreset = 'today' | 'week' | 'month';

/** میان‌برها: امروز، هفته‌ی جاری (شنبه تا جمعه)، ماه شمسی جاری. */
export function jalaliPresetRange(
  preset: JalaliRangePreset,
  timeZone: string,
  now: Date = new Date(),
): JalaliDateRange {
  const today = jalaliToday(timeZone, now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'week': {
      const saturday = addJalaliDays(today, -jalaliWeekdayIndex(today));
      return { from: saturday, to: addJalaliDays(saturday, 6) };
    }
    case 'month':
      return {
        from: { year: today.year, month: today.month, day: 1 },
        to: {
          year: today.year,
          month: today.month,
          day: jalaliMonthLength(today.year, today.month),
        },
      };
  }
}

export function sameJalaliDate(a: JalaliDate | null, b: JalaliDate | null): boolean {
  if (a === null || b === null) return a === b;
  return a.year === b.year && a.month === b.month && a.day === b.day;
}
