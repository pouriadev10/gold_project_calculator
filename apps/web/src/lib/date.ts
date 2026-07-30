import { toPersianDigits } from '@gold/core-calc';
import { format, formatDistanceToNow } from 'date-fns-jalali';

/**
 * تاریخ شمسی با ارقام فارسی.
 *
 * `date-fns-jalali` نام ماه را فارسی می‌دهد ولی ارقام را لاتین
 * می‌گذارد — نتیجه «۸ مرداد ۱۴۰۵» نیست، «8 مرداد 1405» است. این
 * ناهماهنگی درست کنار ارقام فارسی جدول‌ها به چشم می‌آید، پس همه‌ی
 * تاریخ‌ها از این دو تابع عبور می‌کنند، نه از خود کتابخانه.
 */

export function formatJalali(date: Date, pattern: string): string {
  return toPersianDigits(format(date, pattern));
}

export function formatJalaliDistance(date: Date): string {
  return toPersianDigits(formatDistanceToNow(date, { addSuffix: true }));
}
