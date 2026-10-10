import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { toPersianDigits } from '@gold/core-calc';
import { Button } from '@/components/ui/button';
import {
  JALALI_WEEKDAY_SHORT,
  compareJalali,
  formatJalaliDate,
  formatJalaliMonth,
  isInvertedRange,
  jalaliMonthLength,
  jalaliPresetRange,
  jalaliToday,
  jalaliWeekdayIndex,
  sameJalaliDate,
  type JalaliDate,
  type JalaliDateRange,
  type JalaliRangePreset,
} from '@/lib/jalali';
import { cn } from '@/lib/utils';

/**
 * فیلتر مشترک بازه‌ی تاریخ شمسی — FE-071.
 *
 * فقط تاریخ شمسی (روز تقویمی) نگه می‌دارد؛ تبدیل به لحظه‌ی ISO با
 * `jalaliRangeToIso(range, timeZone)` در صفحه‌ی مصرف‌کننده انجام می‌شود تا
 * مرز روز همیشه در منطقه‌ی مستأجر باشد. «امروز» و میان‌برها هم در همان
 * منطقه سنجیده می‌شوند، نه در منطقه‌ی دستگاه.
 *
 * تقویم درون‌خطی باز می‌شود، نه در دیالوگ: هم روی ۳۶۰px بدون لایه‌ی اضافه
 * جا می‌شود و هم از باگ شناخته‌شده‌ی `ResponsiveDialog` دور می‌ماند. هر
 * خانه‌ی روز حداقل ۴۴×۴۴ است.
 */

type Field = 'from' | 'to';

const PRESETS: ReadonlyArray<{ value: JalaliRangePreset; label: string }> = [
  { value: 'today', label: 'امروز' },
  { value: 'week', label: 'این هفته' },
  { value: 'month', label: 'این ماه' },
];

const FIELD_LABEL: Record<Field, string> = { from: 'از تاریخ', to: 'تا تاریخ' };

interface MonthView {
  readonly year: number;
  readonly month: number;
}

function shiftMonth(view: MonthView, delta: number): MonthView {
  const zeroBased = view.year * 12 + (view.month - 1) + delta;
  const month = (zeroBased % 12) + 1;
  return { year: (zeroBased - (month - 1)) / 12, month };
}

function sameRange(a: JalaliDateRange, b: JalaliDateRange): boolean {
  return sameJalaliDate(a.from, b.from) && sameJalaliDate(a.to, b.to);
}

export interface JalaliDateRangeFilterProps {
  readonly value: JalaliDateRange;
  readonly onChange: (next: JalaliDateRange) => void;
  /** منطقه‌ی زمانی مستأجر — از `useTenantTimeZone`. */
  readonly timeZone: string;
  /** پیشوند یکتای شناسه‌ها وقتی چند فیلتر در یک صفحه‌اند. */
  readonly idPrefix: string;
  readonly className?: string;
}

export function JalaliDateRangeFilter({
  value,
  onChange,
  timeZone,
  idPrefix,
  className,
}: JalaliDateRangeFilterProps) {
  const today = jalaliToday(timeZone);
  const [activeField, setActiveField] = useState<Field | null>(null);
  const [view, setView] = useState<MonthView>({ year: today.year, month: today.month });
  const calendarId = `${idPrefix}-calendar`;
  const inverted = isInvertedRange(value);
  const hasValue = value.from !== null || value.to !== null;

  function openField(field: Field): void {
    if (activeField === field) {
      setActiveField(null);
      return;
    }
    const anchor = value[field] ?? (field === 'to' ? value.from : value.to) ?? today;
    setView({ year: anchor.year, month: anchor.month });
    setActiveField(field);
  }

  function pick(date: JalaliDate): void {
    if (activeField === null) return;
    const next = { ...value, [activeField]: date };
    onChange(next);
    // پس از «از تاریخ»، اگر پایان هنوز خالی است مستقیم سراغش برو.
    setActiveField(activeField === 'from' && next.to === null ? 'to' : null);
  }

  function applyPreset(preset: JalaliRangePreset): void {
    setActiveField(null);
    onChange(jalaliPresetRange(preset, timeZone));
  }

  function clear(): void {
    setActiveField(null);
    onChange({ from: null, to: null });
  }

  const leadingBlanks = jalaliWeekdayIndex({ year: view.year, month: view.month, day: 1 });
  const monthLength = jalaliMonthLength(view.year, view.month);
  const days = Array.from({ length: monthLength }, (_, index) => ({
    year: view.year,
    month: view.month,
    day: index + 1,
  }));

  return (
    <fieldset className={cn('min-w-0 space-y-2', className)}>
      <legend className="sr-only">بازه تاریخ</legend>

      <div className="flex flex-wrap gap-2" role="group" aria-label="میان‌برهای بازه">
        {PRESETS.map((preset) => (
          <Button
            key={preset.value}
            type="button"
            size="sm"
            variant={sameRange(value, jalaliPresetRange(preset.value, timeZone)) ? 'secondary' : 'outline'}
            aria-pressed={sameRange(value, jalaliPresetRange(preset.value, timeZone))}
            onClick={() => applyPreset(preset.value)}
          >
            {preset.label}
          </Button>
        ))}
        <Button type="button" size="sm" variant="ghost" disabled={!hasValue} onClick={clear}>
          <X className="size-4" aria-hidden="true" />
          پاک کردن تاریخ
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(['from', 'to'] as const).map((field) => {
          const selectedDate = value[field];
          return (
          <button
            key={field}
            type="button"
            id={`${idPrefix}-${field}`}
            aria-expanded={activeField === field}
            aria-controls={calendarId}
            onClick={() => openField(field)}
            className={cn(
              'flex min-h-touch min-w-0 cursor-pointer flex-col items-start justify-center gap-0.5 rounded-md border border-input bg-background px-3 py-1.5 text-start transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              activeField === field && 'border-primary',
            )}
          >
            <span className="text-xs text-muted-foreground">{FIELD_LABEL[field]}</span>
            <span className="flex w-full min-w-0 items-center gap-1 text-sm font-medium">
              <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate tabular-nums">
                {selectedDate ? formatJalaliDate(selectedDate) : 'انتخاب نشده'}
              </span>
            </span>
          </button>
          );
        })}
      </div>

      {activeField !== null ? (
        <div
          id={calendarId}
          role="group"
          aria-label={`تقویم ${FIELD_LABEL[activeField]}`}
          className="rounded-lg border border-border bg-card p-2"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="ماه قبل"
              onClick={() => setView((current) => shiftMonth(current, -1))}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
            <p className="text-sm font-semibold" aria-live="polite">
              {formatJalaliMonth(view.year, view.month)}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="ماه بعد"
              onClick={() => setView((current) => shiftMonth(current, 1))}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="grid grid-cols-7 text-center text-xs text-muted-foreground" aria-hidden="true">
            {JALALI_WEEKDAY_SHORT.map((weekday) => (
              <span key={weekday} className="py-1">
                {weekday}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {Array.from({ length: leadingBlanks }, (_, index) => (
              <span key={`blank-${index}`} aria-hidden="true" />
            ))}
            {days.map((date) => {
              const selected = sameJalaliDate(value[activeField], date);
              const inRange =
                value.from !== null &&
                value.to !== null &&
                !inverted &&
                compareJalali(date, value.from) >= 0 &&
                compareJalali(date, value.to) <= 0;
              const isToday = sameJalaliDate(today, date);
              return (
                <button
                  key={date.day}
                  type="button"
                  aria-label={formatJalaliDate(date)}
                  aria-pressed={selected}
                  aria-current={isToday ? 'date' : undefined}
                  onClick={() => pick(date)}
                  className={cn(
                    'min-h-touch w-full min-w-0 cursor-pointer rounded-md text-sm tabular-nums transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    inRange && 'bg-accent',
                    isToday && 'font-bold underline underline-offset-4',
                    selected && 'bg-primary text-primary-foreground hover:bg-primary/90',
                  )}
                >
                  {toPersianDigits(String(date.day))}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {inverted ? (
        <p className="text-sm text-destructive" role="alert">
          تاریخ پایان نمی‌تواند پیش از تاریخ شروع باشد.
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        مرز هر روز با منطقه زمانی فروشگاه (<bdi dir="ltr">{timeZone}</bdi>) حساب می‌شود.
      </p>
    </fieldset>
  );
}
