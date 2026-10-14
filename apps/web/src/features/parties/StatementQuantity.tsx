import { dualFromPure, dualFromRial, formatCount, formatGram, toSafeNumber } from '@gold/core-calc';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { useUnitStore } from '@/stores/unit-store';
import { convertibleUnit } from './party-statement';
import type { LockedStatementRate, PartyStatementDimension } from './party-statement';

/**
 * سلول‌های مبلغ یک رویداد صورت‌حساب — مشترک بین صفحه‌ی صورت‌حساب (FE-070) و «آخرین معاملات»
 * صفحه‌ی شخص. FE-103: پیش از این، کارت «آخرین معاملات» مقدار را به‌صورت متن «… ریال / … گرم»
 * می‌نوشت و نه از `AmountDisplay` عبور می‌کرد و نه معادل واحد انتخابی را داشت؛ حالا هر دو صفحه
 * همین یک پیاده‌سازی را نشان می‌دهند.
 */

/** مقدار خام یک بُعد در واحد اصلی خودش — ریال، گرم یا تعداد سکه. */
export function RawQuantity({
  dimension,
  value,
  signed = false,
}: {
  dimension: PartyStatementDimension;
  value: bigint;
  signed?: boolean;
}) {
  const unit = convertibleUnit(dimension);
  const prefix = signed && value > 0n ? '+' : '';
  if (unit !== null) {
    return (
      <span className="inline-flex items-baseline gap-0.5">
        {prefix ? <span aria-hidden="true">{prefix}</span> : null}
        <AmountDisplay amount={{ kind: 'raw', value, unit }} size="sm" />
      </span>
    );
  }
  // سکه شمارشی است و نقره با مظنه طلا قیمت نمی‌خورد؛ هر دو فقط مقدار خام.
  const label = dimension.kind === 'COIN' ? 'عدد' : 'گرم';
  return (
    <span className="inline-flex items-baseline gap-1 tabular-nums" data-raw={value.toString()}>
      <bdi className="text-sm font-semibold">
        {prefix}
        {dimension.kind === 'COIN' ? formatCount(toSafeNumber(value)) : formatGram(value)}
      </bdi>
      <span className="text-xs font-normal text-muted-foreground">{label}</span>
    </span>
  );
}

/**
 * معادل با واحد انتخابی، فقط با نرخ سند. وقتی واحد فعال همان واحد خام
 * است چیزی نشان نمی‌دهد — مقدار خام همان پاسخ است.
 */
export function LockedEquivalent({
  dimension,
  value,
  rate,
}: {
  dimension: PartyStatementDimension;
  value: bigint;
  rate: LockedStatementRate | null;
}) {
  const activeUnit = useUnitStore((state) => state.unit);
  const unit = convertibleUnit(dimension);
  if (unit === null || unit === activeUnit) return null;
  if (rate === null) {
    return <span className="block text-xs text-muted-foreground">معادل: نرخ سند ثبت نشده</span>;
  }
  const dual =
    unit === 'rial' ? dualFromRial(value, rate.rate1000) : dualFromPure(value, rate.rate1000);
  return (
    <span className="flex flex-wrap items-baseline gap-1 text-xs text-muted-foreground">
      معادل:
      <AmountDisplay amount={dual} size="sm" />
    </span>
  );
}
