import { toPersianDigits } from '@gold/core-calc';
import type { LedgerProfitReport } from '@/api/contracts';
import {
  JALALI_MONTH_NAMES,
  addJalaliDays,
  compareJalali,
  jalaliMonthLength,
  jalaliToDayNumber,
  jalaliWeekdayIndex,
  type JalaliDate,
  type JalaliDateRange,
} from '@/lib/jalali';
import type { MoneyUnit } from '@/stores/unit-store';
import { measureFace } from './profit-report';

/**
 * روند سود — FE-076.
 *
 * BE-060 فقط جمع یک بازه را می‌دهد، نه سری زمانی. پس روند با تقسیم بازه‌ی
 * انتخابی به چند «سطل» و یک درخواست جدا برای هر سطل ساخته می‌شود؛ هر عدد
 * همچنان همان محاسبه‌ی سرور است. اندازه‌ی سطل با طول بازه عوض می‌شود تا
 * تعداد درخواست‌ها کم بماند:
 *   ≤ ۷ روز  → روزانه
 *   ≤ ۹۲ روز → هفتگی (شنبه تا جمعه، بریده به مرز بازه)
 *   بیشتر    → ماهانه (ماه شمسی، فقط ۱۲ ماه آخر بازه)
 * بازه‌ی یک‌روزه روند ندارد. بدون بازه، شش ماه شمسی آخر نشان داده می‌شود.
 */

export type TrendGranularity = 'day' | 'week' | 'month';

export interface TrendBucket {
  readonly from: JalaliDate;
  readonly to: JalaliDate;
  readonly label: string;
}

export interface TrendPlan {
  readonly granularity: TrendGranularity;
  readonly buckets: readonly TrendBucket[];
}

const DAILY_MAX_DAYS = 7;
const WEEKLY_MAX_DAYS = 92;
const MAX_MONTH_BUCKETS = 12;
const DEFAULT_MONTHS = 6;

function dayLabel(date: JalaliDate): string {
  return `${toPersianDigits(String(date.day))} ${JALALI_MONTH_NAMES[date.month - 1]}`;
}

function monthStart(year: number, month: number): JalaliDate {
  return { year, month, day: 1 };
}

function monthEnd(year: number, month: number): JalaliDate {
  return { year, month, day: jalaliMonthLength(year, month) };
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + delta;
  const nextMonth = (zeroBased % 12) + 1;
  return { year: (zeroBased - (nextMonth - 1)) / 12, month: nextMonth };
}

function minDate(a: JalaliDate, b: JalaliDate): JalaliDate {
  return compareJalali(a, b) <= 0 ? a : b;
}

function maxDate(a: JalaliDate, b: JalaliDate): JalaliDate {
  return compareJalali(a, b) >= 0 ? a : b;
}

/** بازه‌ی کامل روند؛ سرهای خالی بازه با «امروز» یا شش ماه اخیر پر می‌شوند. */
export function resolveTrendRange(range: JalaliDateRange, today: JalaliDate): { from: JalaliDate; to: JalaliDate } {
  const to = range.to ?? (range.from ? maxDate(range.from, today) : monthEnd(today.year, today.month));
  if (range.from) return { from: range.from, to };
  const start = shiftMonth(to.year, to.month, -(DEFAULT_MONTHS - 1));
  return { from: monthStart(start.year, start.month), to };
}

export function planProfitTrend(range: JalaliDateRange, today: JalaliDate): TrendPlan | null {
  const { from, to } = resolveTrendRange(range, today);
  if (compareJalali(from, to) >= 0) return null;
  const spanDays = jalaliToDayNumber(to) - jalaliToDayNumber(from) + 1;

  if (spanDays <= DAILY_MAX_DAYS) {
    const buckets = Array.from({ length: spanDays }, (_, index) => {
      const day = addJalaliDays(from, index);
      return { from: day, to: day, label: dayLabel(day) };
    });
    return { granularity: 'day', buckets };
  }

  if (spanDays <= WEEKLY_MAX_DAYS) {
    const buckets: TrendBucket[] = [];
    let start = from;
    while (compareJalali(start, to) <= 0) {
      const weekEnd = addJalaliDays(start, 6 - jalaliWeekdayIndex(start));
      const end = minDate(weekEnd, to);
      buckets.push({ from: start, to: end, label: dayLabel(start) });
      start = addJalaliDays(end, 1);
    }
    return { granularity: 'week', buckets };
  }

  const buckets: TrendBucket[] = [];
  let cursor = { year: from.year, month: from.month };
  while (compareJalali(monthStart(cursor.year, cursor.month), to) <= 0) {
    buckets.push({
      from: maxDate(monthStart(cursor.year, cursor.month), from),
      to: minDate(monthEnd(cursor.year, cursor.month), to),
      label: `${JALALI_MONTH_NAMES[cursor.month - 1]} ${toPersianDigits(String(cursor.year % 100).padStart(2, '0'))}`,
    });
    cursor = shiftMonth(cursor.year, cursor.month, 1);
  }
  return { granularity: 'month', buckets: buckets.slice(-MAX_MONTH_BUCKETS) };
}

export interface TrendSeries {
  readonly labels: readonly string[];
  /** حاصل اجرت و حاشیه — `operatingProfit` سرور. */
  readonly operating: readonly bigint[];
  readonly coinBubble: readonly bigint[];
  readonly goldPrice: readonly bigint[];
  /** `totalProfit` سرور — برابر جمع سه سری بالا. */
  readonly total: readonly bigint[];
}

/**
 * سری‌های نمودار در واحد فعال؛ فقط چهره‌ی سرور انتخاب می‌شود، بدون تبدیل.
 * سه منشأ سود جدا می‌مانند (سود کل سرور = عملیاتی + حباب سکه + نوسان طلا).
 */
export function trendSeries(
  buckets: readonly TrendBucket[],
  reports: readonly LedgerProfitReport[],
  unit: MoneyUnit,
): TrendSeries {
  return {
    labels: buckets.map((bucket) => bucket.label),
    operating: reports.map((report) => measureFace(report.operatingProfit, unit)),
    coinBubble: reports.map((report) => measureFace(report.coinBubbleEffect, unit)),
    goldPrice: reports.map((report) => measureFace(report.goldPriceEffect, unit)),
    total: reports.map((report) => measureFace(report.totalProfit, unit)),
  };
}
