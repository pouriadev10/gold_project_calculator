import type { DualAmount } from '@gold/core-calc';
import { formatGram, formatRial } from '@gold/core-calc';
import { cn } from '@/lib/utils';
import { UNIT_LABEL, useUnitStore, type MoneyUnit } from '@/stores/unit-store';

/**
 * تنها مسیر مجاز رندر عدد مالی در کل برنامه.
 *
 * هیچ عددی مستقیم در JSX نوشته نمی‌شود. دلیلش فقط تمیزی نیست:
 * کلید تعویض واحد باید **همه‌ی** اعداد صفحه را هم‌زمان عوض کند، و این
 * تنها وقتی تضمین می‌شود که یک نقطه‌ی رندر وجود داشته باشد.
 *
 * قالب‌بندی از `core-calc` می‌آید — همان کدی که سرور استفاده می‌کند.
 */

const SIZE_CLASS = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-2xl',
  xl: 'text-3xl',
} as const;

export interface AmountDisplayProps {
  amount: DualAmount;
  /** بازنویسی واحد فعال. اگر ندهی، تنظیم سراسری کاربر خوانده می‌شود. */
  unit?: MoneyUnit;
  /** رنگ‌آمیزی بر اساس علامت: مثبت بستانکار، منفی بدهکار. */
  signed?: boolean;
  /** نمایش برچسب واحد کنار عدد. */
  showUnit?: boolean;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}

export function AmountDisplay({
  amount,
  unit,
  signed = false,
  showUnit = true,
  size = 'md',
  className,
}: AmountDisplayProps) {
  const globalUnit = useUnitStore((state) => state.unit);
  const activeUnit = unit ?? globalUnit;

  const isGold = activeUnit === 'gold';
  const raw = isGold ? amount.pureMg : amount.rial;
  const text = isGold ? formatGram(amount.pureMg) : formatRial(amount.rial);

  const toneClass = signed
    ? raw > 0n
      ? 'text-credit'
      : raw < 0n
        ? 'text-debit'
        : 'text-muted-foreground'
    : undefined;

  return (
    <span
      className={cn('inline-flex items-baseline gap-1 tabular-nums', toneClass, className)}
      // مقدار لاتین و صحیح برای کپی، تست و ابزار کمکی — نمایش فارسی است
      data-raw={raw.toString()}
      data-unit={activeUnit}
    >
      <bdi className={cn('font-semibold', SIZE_CLASS[size])}>{text}</bdi>
      {showUnit ? (
        <span className="text-xs font-normal text-muted-foreground">{UNIT_LABEL[activeUnit]}</span>
      ) : null}
    </span>
  );
}

/**
 * نمایش **نرخ**، نه مبلغ.
 *
 * مظنه و نرخ گرم ذاتاً ریالی‌اند؛ تبدیلشان به گرم بی‌معناست (نرخ طلا
 * برحسب طلا همیشه یک است). پس عمداً از کلید تعویض واحد پیروی نمی‌کنند،
 * ولی باز هم از همان قالب‌بندی `core-calc` عبور می‌کنند.
 */
export function RateDisplay({
  value,
  className,
  size = 'md',
}: {
  value: bigint;
  className?: string;
  size?: keyof typeof SIZE_CLASS;
}) {
  return (
    <span
      className={cn('inline-flex items-baseline gap-1 tabular-nums', className)}
      data-raw={value.toString()}
      data-unit="rial"
    >
      <bdi className={cn('font-semibold', SIZE_CLASS[size])}>{formatRial(value)}</bdi>
      <span className="text-xs font-normal text-muted-foreground">{UNIT_LABEL.rial}</span>
    </span>
  );
}
