import type { DualAmount, Karat } from '@gold/core-calc';
import { formatGram, formatRial, fromPureMgSigned } from '@gold/core-calc';
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

/** مقدار خامِ تک‌واحدی؛ وقتی مظنه مرجع وجود ندارد نباید معادل ساختگی بسازیم. */
export interface RawAmount {
  readonly kind: 'raw';
  readonly value: bigint;
  readonly unit: MoneyUnit;
}

/**
 * هر دو چهره‌ی یک مبلغ، هر دو از سرور و بدون نرخ واحد — FE-103. گزارش سود چنین سنجه‌ای دارد:
 * طلای معادل هر رویداد با مظنه‌ی قفل‌شده‌ی همان رویداد جمع شده و یک «نرخ» مشترک ندارد، پس
 * `DualAmount` (که `rate1000` می‌خواهد) نیست؛ ولی مثل آن از کلید سراسری واحد پیروی می‌کند.
 */
export interface FacesAmount {
  readonly kind: 'faces';
  readonly rial: bigint;
  readonly pureMg: bigint;
}

export interface AmountDisplayProps {
  amount: DualAmount | RawAmount | FacesAmount;
  /** بازنویسی واحد برای مبلغ دومقیاسه؛ مقدار خام همیشه در واحد اصلی خودش می‌ماند. */
  unit?: MoneyUnit;
  /**
   * در واحد طلا، گرم را به معادل این عیار نشان بده (مثلاً ۷۵۰) به‌جای
   * مبنای خالص ۱۰۰۰. تبدیل ثابت وزنی است، نه ریالی — نرخ لحظه‌ای در آن
   * دخیل نیست. روی واحد ریال بی‌اثر است.
   */
  karat?: Karat;
  /** رنگ‌آمیزی بر اساس علامت: مثبت بستانکار، منفی بدهکار. */
  signed?: boolean;
  /** نمایش برچسب واحد کنار عدد. */
  showUnit?: boolean;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}

/** مقدار خام همیشه در واحد خودش؛ دومقیاسه و دوچهره در واحد انتخابی (یا بازنویسی‌شده). */
function resolveAmount(
  amount: AmountDisplayProps['amount'],
  selectedUnit: MoneyUnit,
  karat: Karat | undefined,
): { activeUnit: MoneyUnit; raw: bigint } {
  if ('kind' in amount && amount.kind === 'raw') return { activeUnit: amount.unit, raw: amount.value };
  if (selectedUnit === 'rial') return { activeUnit: 'rial', raw: amount.rial };
  return {
    activeUnit: 'gold',
    raw: karat !== undefined ? fromPureMgSigned(amount.pureMg, karat) : amount.pureMg,
  };
}

export function AmountDisplay({
  amount,
  unit,
  karat,
  signed = false,
  showUnit = true,
  size = 'md',
  className,
}: AmountDisplayProps) {
  const globalUnit = useUnitStore((state) => state.unit);
  const isRawOnly = 'kind' in amount && amount.kind === 'raw';
  const { activeUnit, raw } = resolveAmount(amount, unit ?? globalUnit, karat);
  const isGold = activeUnit === 'gold';
  const text = isGold ? formatGram(raw) : formatRial(raw);

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
      // FE-103: مبلغی که از کلید سراسری واحد پیروی می‌کند — مبنای ممیزی خودکار صفحات مالی
      data-follows-unit={!isRawOnly && unit === undefined ? 'true' : undefined}
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
