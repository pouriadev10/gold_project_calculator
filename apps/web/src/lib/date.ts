/**
 * تاریخ شمسی — با `Intl` بومی مرورگر، بدون هیچ کتابخانه.
 *
 * `Intl.DateTimeFormat('fa-IR')` پیش‌فرض تقویم **جلالی** را می‌دهد و
 * ارقام را هم فارسی برمی‌گرداند. یعنی هم درست‌تر از `date-fns-jalali`
 * است (آن کتابخانه نام ماه را فارسی می‌داد ولی ارقام را لاتین می‌گذاشت)
 * و هم **صفر بایت** روی مسیر بحرانی می‌گذارد.
 *
 * `date-fns-jalali` همچنان نصب است و در صفحه‌ی دود آزموده می‌شود، ولی
 * وارد بسته‌ی production نمی‌شود — روی 3G هر کیلوبایت مسیر بحرانی
 * مستقیماً به LCP تبدیل می‌شود.
 */

const DATE_TIME = new Intl.DateTimeFormat('fa-IR', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const FULL_DATE = new Intl.DateTimeFormat('fa-IR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const RELATIVE = new Intl.RelativeTimeFormat('fa', { numeric: 'auto' });

/** «۸ مرداد — ۱۱:۴۲» */
export function formatJalaliDateTime(date: Date): string {
  const parts = DATE_TIME.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';

  return `${pick('day')} ${pick('month')} — ${pick('hour')}:${pick('minute')}`;
}

/** «پنجشنبه ۸ مرداد ۱۴۰۵» — ترتیب اجزا دستی چیده می‌شود، چون خروجی خام `fa-IR` سال را اول می‌آورد. */
export function formatJalaliFullDate(date: Date): string {
  const parts = FULL_DATE.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';

  return `${pick('weekday')} ${pick('day')} ${pick('month')} ${pick('year')}`;
}

const SECOND = 1000n;
const MINUTE = 60n * SECOND;
const HOUR = 60n * MINUTE;
const DAY = 24n * HOUR;

/**
 * «۱۴ ساعت پیش»
 *
 * تقسیم با `bigint` انجام می‌شود، نه با `Math.floor` — هم قاعده‌ی پروژه
 * است و هم تقسیم صحیح اینجا دقیقاً همان چیزی است که می‌خواهیم.
 */
export function formatJalaliDistance(date: Date, now: Date = new Date()): string {
  const deltaMs = BigInt(date.getTime() - now.getTime());
  const magnitude = deltaMs < 0n ? -deltaMs : deltaMs;

  if (magnitude < MINUTE) return 'لحظاتی پیش';
  if (magnitude < HOUR) return RELATIVE.format(Number(deltaMs / MINUTE), 'minute');
  if (magnitude < DAY) return RELATIVE.format(Number(deltaMs / HOUR), 'hour');
  if (magnitude < 30n * DAY) return RELATIVE.format(Number(deltaMs / DAY), 'day');

  return formatJalaliFullDate(date);
}
