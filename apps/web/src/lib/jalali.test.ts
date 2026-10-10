import { describe, expect, it } from 'vitest';
import {
  addJalaliDays,
  compareJalali,
  dayNumberToGregorian,
  dayNumberToJalali,
  endOfJalaliDay,
  formatJalaliDate,
  formatJalaliMonth,
  gregorianToDayNumber,
  isInvertedRange,
  isJalaliLeapYear,
  isValidJalaliDate,
  isValidTimeZone,
  jalaliMonthLength,
  jalaliPresetRange,
  jalaliRangeToHalfOpenIso,
  jalaliRangeToIso,
  jalaliToDayNumber,
  jalaliToday,
  jalaliWeekdayIndex,
  sameJalaliDate,
  startOfJalaliDay,
} from './jalali';

/** FE-071 — تقویم شمسی و مرز روز در منطقه‌ی مستأجر. */

const TEHRAN = 'Asia/Tehran';

describe('جلالی ↔ میلادی', () => {
  it.each([
    [{ year: 1403, month: 1, day: 1 }, '2024-03-20'],
    [{ year: 1404, month: 1, day: 1 }, '2025-03-21'],
    [{ year: 1399, month: 12, day: 30 }, '2021-03-20'],
    [{ year: 1402, month: 12, day: 29 }, '2024-03-19'],
    [{ year: 1405, month: 7, day: 18 }, '2026-10-10'],
    [{ year: 1357, month: 11, day: 22 }, '1979-02-11'],
  ])('%o ↔ %s', (jalali, iso) => {
    const [y, m, d] = iso.split('-').map((part) => Number.parseInt(part, 10)) as [number, number, number];
    const jdn = jalaliToDayNumber(jalali);
    expect(jdn).toBe(gregorianToDayNumber(y, m, d));
    expect(dayNumberToJalali(jdn)).toEqual(jalali);
    expect(dayNumberToGregorian(jdn)).toEqual({ year: y, month: m, day: d });
  });

  it('با تقویم persian خودِ Intl روز‌به‌روز در ۱۱ سال هم‌خوان است', () => {
    const intl = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    const start = gregorianToDayNumber(2020, 1, 1);
    for (let jdn = start; jdn < start + 4018; jdn += 1) {
      const parts = intl.formatToParts(new Date((jdn - 2_440_588) * 86_400_000));
      const pick = (type: string) =>
        Number.parseInt(parts.find((part) => part.type === type)?.value ?? '0', 10);
      const expected = { year: pick('year'), month: pick('month'), day: pick('day') };
      const actual = dayNumberToJalali(jdn);
      if (actual.year !== expected.year || actual.month !== expected.month || actual.day !== expected.day) {
        throw new Error(`JDN ${jdn}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
      }
      expect(jalaliToDayNumber(actual)).toBe(jdn);
    }
  });

  it('سال کبیسه و طول ماه‌ها', () => {
    expect(isJalaliLeapYear(1399)).toBe(true);
    expect(isJalaliLeapYear(1403)).toBe(true);
    expect(isJalaliLeapYear(1404)).toBe(false);
    expect(jalaliMonthLength(1404, 1)).toBe(31);
    expect(jalaliMonthLength(1404, 7)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
    expect(jalaliMonthLength(1403, 12)).toBe(30);
  });

  it('تاریخ نامعتبر را رد می‌کند', () => {
    expect(isValidJalaliDate({ year: 1404, month: 12, day: 30 })).toBe(false);
    expect(isValidJalaliDate({ year: 1403, month: 12, day: 30 })).toBe(true);
    expect(isValidJalaliDate({ year: 1404, month: 13, day: 1 })).toBe(false);
    expect(isValidJalaliDate({ year: 1404, month: 0, day: 1 })).toBe(false);
    expect(isValidJalaliDate({ year: 1404, month: 1, day: 0 })).toBe(false);
    expect(isValidJalaliDate({ year: 0, month: 1, day: 1 })).toBe(false);
    expect(isValidJalaliDate({ year: 3178, month: 1, day: 1 })).toBe(false);
    expect(isValidJalaliDate({ year: 1404.5, month: 1, day: 1 })).toBe(false);
    expect(() => jalaliToDayNumber({ year: 1404, month: 12, day: 30 })).toThrow(RangeError);
  });

  it('حساب روز، مقایسه و روز هفته (شنبه = ۰)', () => {
    expect(addJalaliDays({ year: 1404, month: 12, day: 29 }, 1)).toEqual({ year: 1405, month: 1, day: 1 });
    expect(addJalaliDays({ year: 1405, month: 1, day: 1 }, -1)).toEqual({ year: 1404, month: 12, day: 29 });
    expect(compareJalali({ year: 1405, month: 1, day: 2 }, { year: 1405, month: 1, day: 1 })).toBe(1);
    // ۱۸ مهر ۱۴۰۵ = شنبه ۱۰ اکتبر ۲۰۲۶
    expect(jalaliWeekdayIndex({ year: 1405, month: 7, day: 18 })).toBe(0);
    expect(jalaliWeekdayIndex({ year: 1405, month: 7, day: 24 })).toBe(6);
    expect(sameJalaliDate(null, null)).toBe(true);
    expect(sameJalaliDate({ year: 1405, month: 1, day: 1 }, null)).toBe(false);
    expect(sameJalaliDate({ year: 1405, month: 1, day: 1 }, { year: 1405, month: 1, day: 1 })).toBe(true);
  });

  it('قالب فارسی', () => {
    expect(formatJalaliDate({ year: 1405, month: 7, day: 18 })).toBe('۱۸ مهر ۱۴۰۵');
    expect(formatJalaliMonth(1405, 12)).toBe('اسفند ۱۴۰۵');
  });
});

describe('مرز روز در منطقه‌ی مستأجر', () => {
  it('نیمه‌شب تهران (+۰۳:۳۰) را درست به UTC می‌برد', () => {
    const day = { year: 1405, month: 7, day: 18 };
    expect(startOfJalaliDay(day, TEHRAN).toISOString()).toBe('2026-10-09T20:30:00.000Z');
    expect(endOfJalaliDay(day, TEHRAN).toISOString()).toBe('2026-10-10T20:29:59.999Z');
  });

  it('ساعت تابستانی تاریخی تهران (+۰۴:۳۰ در ۱۴۰۰) را رعایت می‌کند', () => {
    expect(startOfJalaliDay({ year: 1400, month: 3, day: 11 }, TEHRAN).toISOString()).toBe(
      '2021-05-31T19:30:00.000Z',
    );
  });

  it('روز تغییر ساعت در منطقه‌ای دیگر هم مرز درست دارد', () => {
    // ۸ مارس ۲۰۲۶ — آغاز ساعت تابستانی نیویورک؛ روزش ۲۳ ساعت است.
    const dstDay = addJalaliDays({ year: 1404, month: 12, day: 17 }, 0);
    expect(startOfJalaliDay(dstDay, 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(endOfJalaliDay(dstDay, 'America/New_York').toISOString()).toBe('2026-03-09T03:59:59.999Z');
  });

  it('امروز را در منطقه‌ی مستأجر می‌سنجد، نه در UTC', () => {
    // ۲۱:۰۰ UTC روز ۹ اکتبر = ۰۰:۳۰ بامداد ۱۰ اکتبر در تهران.
    const now = new Date('2026-10-09T21:00:00.000Z');
    expect(jalaliToday(TEHRAN, now)).toEqual({ year: 1405, month: 7, day: 18 });
    expect(jalaliToday('UTC', now)).toEqual({ year: 1405, month: 7, day: 17 });
  });

  it('منطقه‌ی زمانی نامعتبر را تشخیص می‌دهد', () => {
    expect(isValidTimeZone(TEHRAN)).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe('بازه و میان‌برها', () => {
  const now = new Date('2026-10-12T08:00:00.000Z'); // دوشنبه ۲۰ مهر ۱۴۰۵

  it('بازه را به ISO شامل با مرزهای منطقه‌ی مستأجر تبدیل می‌کند', () => {
    expect(
      jalaliRangeToIso(
        { from: { year: 1405, month: 7, day: 1 }, to: { year: 1405, month: 7, day: 30 } },
        TEHRAN,
      ),
    ).toEqual({ from: '2026-09-22T20:30:00.000Z', to: '2026-10-22T20:29:59.999Z' });
    expect(jalaliRangeToIso({ from: null, to: null }, TEHRAN)).toEqual({});
    expect(jalaliRangeToIso({ from: { year: 1405, month: 7, day: 1 }, to: null }, TEHRAN)).toEqual({
      from: '2026-09-22T20:30:00.000Z',
    });
  });

  it('برای to انحصاری، مرز پایان نیمه‌شب روز بعد است', () => {
    expect(
      jalaliRangeToHalfOpenIso(
        { from: { year: 1405, month: 7, day: 1 }, to: { year: 1405, month: 7, day: 30 } },
        TEHRAN,
      ),
    ).toEqual({ from: '2026-09-22T20:30:00.000Z', to: '2026-10-22T20:30:00.000Z' });
    // یک روز تنها: from < to اکید، همان شرط profitReportQuerySchema.
    expect(
      jalaliRangeToHalfOpenIso(
        { from: { year: 1405, month: 7, day: 18 }, to: { year: 1405, month: 7, day: 18 } },
        TEHRAN,
      ),
    ).toEqual({ from: '2026-10-09T20:30:00.000Z', to: '2026-10-10T20:30:00.000Z' });
    expect(jalaliRangeToHalfOpenIso({ from: null, to: null }, TEHRAN)).toEqual({});
    expect(
      jalaliRangeToHalfOpenIso(
        { from: { year: 1405, month: 7, day: 2 }, to: { year: 1405, month: 7, day: 1 } },
        TEHRAN,
      ),
    ).toBeNull();
  });

  it('بازه‌ی وارونه null است', () => {
    const inverted = { from: { year: 1405, month: 7, day: 2 }, to: { year: 1405, month: 7, day: 1 } };
    expect(isInvertedRange(inverted)).toBe(true);
    expect(jalaliRangeToIso(inverted, TEHRAN)).toBeNull();
    expect(isInvertedRange({ from: inverted.from, to: null })).toBe(false);
  });

  it('امروز، این هفته (شنبه تا جمعه) و این ماه', () => {
    expect(jalaliPresetRange('today', TEHRAN, now)).toEqual({
      from: { year: 1405, month: 7, day: 20 },
      to: { year: 1405, month: 7, day: 20 },
    });
    expect(jalaliPresetRange('week', TEHRAN, now)).toEqual({
      from: { year: 1405, month: 7, day: 18 },
      to: { year: 1405, month: 7, day: 24 },
    });
    expect(jalaliPresetRange('month', TEHRAN, now)).toEqual({
      from: { year: 1405, month: 7, day: 1 },
      to: { year: 1405, month: 7, day: 30 },
    });
    expect(jalaliPresetRange('month', TEHRAN, new Date('2026-03-01T08:00:00.000Z'))).toEqual({
      from: { year: 1404, month: 12, day: 1 },
      to: { year: 1404, month: 12, day: 29 },
    });
  });
});
