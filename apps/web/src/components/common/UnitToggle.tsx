import { useRef, type KeyboardEvent } from 'react';
import { Coins, Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UNIT_TITLE, useUnitStore, type MoneyUnit } from '@/stores/unit-store';

/**
 * کلید تعویض واحد — طلا ↔ ریال.
 *
 * قاعده‌ی ۲-۴ CLAUDE.md: این کلید روی **هر** صفحه‌ای که عدد مالی دارد
 * باید باشد، نه فقط گزارش سود. چون به استور سراسری وصل است، زدنش در یک
 * صفحه اعداد کل برنامه را هم‌زمان عوض می‌کند.
 */

const OPTIONS: ReadonlyArray<{ value: MoneyUnit; icon: typeof Coins }> = [
  { value: 'gold', icon: Coins },
  { value: 'rial', icon: Landmark },
];

/**
 * FE-092 — الگوی radiogroup: یک توقف Tab (گزینه‌ی فعال) و جهت‌ها بین گزینه‌ها می‌روند و همان
 * لحظه انتخاب می‌کنند. برنامه راست‌به‌چپ است، پس «چپ» یعنی گزینه‌ی بعدی (همان جهت دیداری).
 */
const NEXT_KEYS = new Set(['ArrowDown', 'ArrowLeft']);
const PREVIOUS_KEYS = new Set(['ArrowUp', 'ArrowRight']);

export function UnitToggle({ className }: { className?: string }) {
  const unit = useUnitStore((state) => state.unit);
  const setUnit = useUnitStore((state) => state.setUnit);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = OPTIONS.findIndex((option) => option.value === unit);
    let next: number;
    if (NEXT_KEYS.has(event.key)) next = (current + 1) % OPTIONS.length;
    else if (PREVIOUS_KEYS.has(event.key)) next = (current - 1 + OPTIONS.length) % OPTIONS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = OPTIONS.length - 1;
    else return;
    event.preventDefault();
    const option = OPTIONS[next];
    if (!option) return;
    setUnit(option.value);
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="واحد نمایش اعداد"
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border border-border bg-muted p-1',
        className,
      )}
    >
      {OPTIONS.map(({ value, icon: Icon }, index) => {
        const isActive = unit === value;
        return (
          <button
            key={value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => setUnit(value)}
            className={cn(
              'inline-flex min-h-touch cursor-pointer items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              isActive
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground active:bg-card/60',
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {UNIT_TITLE[value]}
          </button>
        );
      })}
    </div>
  );
}
