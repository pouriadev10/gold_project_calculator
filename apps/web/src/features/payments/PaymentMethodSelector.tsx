import { Banknote, Clock, Coins, Gem, Layers, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * انتخاب روش پرداخت — FE-050، شروع Milestone 12 («پرداخت و تسویه»).
 *
 * فقط **انتخاب‌گر** است، نه فرم‌های خودِ روش‌ها. «هر روش component مستقل
 * داشته باشد» یعنی این فایل مسئول رندر فرم هیچ روشی نیست — `RIAL` سراغ
 * FE-051 می‌رود، `GOLD` سراغ FE-052 (`BE-046`)، `COIN` سراغ FE-053
 * (`BE-047`)، `COMBINED` سراغ FE-054؛ هیچ‌کدام هنوز ساخته نشده‌اند. این
 * کامپوننت فقط تعیین می‌کند **کدام** فعال است؛ مصرف‌کننده (فروش یا تسویه‌ی
 * شخص، FE-055) بر اساس `value` تصمیم می‌گیرد کدام فرم را رندر کند —
 * دقیقاً همان جداسازی که خودِ مرجوعی B2B/B2C را در بخش ۲-۵ CLAUDE.md به
 * دو ماژول جدا مجبور کرده: انتخاب مسیر از پیاده‌سازی مسیر جداست.
 *
 * `COMBINED` («ترکیبی») یک مقدار مستقل دیگر است، نه یک چندگزینی روی چهار
 * تای دیگر — لیست «روش‌های فاز ۱» خودِ تسک همین پنج‌تا را هم‌تراز شمرده و
 * FE-054 («تسویه ترکیبی») هم یک تسک جداست، نه توسیع این انتخاب‌گر؛ پس این
 * یک radio-group پنج‌گزینه‌ای است، نه چندانتخابی.
 *
 * چک پیچیده و قسط‌بندی عمداً در هیچ‌جای این ماژول یا آینده‌ی FE-051..054
 * وجود ندارند — هر دو صریح در «قواعد» همین تسک ممنوع شده‌اند.
 */

export const PAYMENT_METHODS = ['RIAL', 'GOLD', 'COIN', 'CREDIT', 'COMBINED'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const METHOD_LABEL: Record<PaymentMethod, string> = {
  RIAL: 'ریال',
  GOLD: 'طلا',
  COIN: 'سکه',
  CREDIT: 'نسیه',
  COMBINED: 'ترکیبی',
};

const METHOD_ICON: Record<PaymentMethod, LucideIcon> = {
  RIAL: Banknote,
  GOLD: Gem,
  COIN: Coins,
  CREDIT: Clock,
  COMBINED: Layers,
};

export interface PaymentMethodSelectorProps {
  readonly value: PaymentMethod | null;
  readonly onChange: (method: PaymentMethod) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function PaymentMethodSelector({ value, onChange, disabled = false, className }: PaymentMethodSelectorProps) {
  return (
    <div role="radiogroup" aria-label="روش پرداخت" className={cn('grid grid-cols-3 gap-2', className)}>
      {PAYMENT_METHODS.map((method) => {
        const Icon = METHOD_ICON[method];
        const selected = value === method;
        return (
          <button
            key={method}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(method)}
            className={cn(
              'flex min-h-touch cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              selected
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-input bg-transparent text-foreground',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
            {METHOD_LABEL[method]}
          </button>
        );
      })}
    </div>
  );
}
