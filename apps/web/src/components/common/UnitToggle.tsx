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

export function UnitToggle({ className }: { className?: string }) {
  const unit = useUnitStore((state) => state.unit);
  const setUnit = useUnitStore((state) => state.setUnit);

  return (
    <div
      role="radiogroup"
      aria-label="واحد نمایش اعداد"
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border border-border bg-muted p-1',
        className,
      )}
    >
      {OPTIONS.map(({ value, icon: Icon }) => {
        const isActive = unit === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
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
