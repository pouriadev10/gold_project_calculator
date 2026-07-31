import {
  DIGIT_SPECS,
  digitsToBigInt,
  formatGram,
  formatKarat,
  formatRial,
  gramRate,
  karat,
  mulDivHalfUp,
  toSafeNumber,
} from '@gold/core-calc';
import { useKeypadStore } from './keypad-store';

/**
 * پیش‌نمایش زنده‌ی قیمت، بالای کیپد.
 *
 * در همان لحظه‌ی هر ضربه با `core-calc` محاسبه می‌شود — همان موتوری که
 * سرور استفاده می‌کند، پس عددی که کاربر حین تایپ می‌بیند دقیقاً همان
 * عددی است که در فاکتور ثبت خواهد شد.
 *
 * اگر فیلدهای لازم (وزن، عیار، مظنه) روی فرم نباشند، نوار فقط مقدار
 * فیلد فعال را نشان می‌دهد — کیپد به هیچ صفحه‌ی خاصی وابسته نیست.
 */

const MIN_KARAT = 300;
const MAX_KARAT = 999;

function useFieldValue(kind: 'weight' | 'karat' | 'mazneh'): bigint | null {
  return useKeypadStore((state) => {
    const field = state.fields.find((f) => f.kind === kind);
    if (!field) return null;
    return digitsToBigInt(state.buffers[field.id] ?? '', DIGIT_SPECS[kind]);
  });
}

export function KeypadPreview() {
  const weightMg = useFieldValue('weight');
  const karatValue = useFieldValue('karat');
  const maznehRial = useFieldValue('mazneh');

  const hasKarat = karatValue !== null && karatValue >= BigInt(MIN_KARAT) && karatValue <= BigInt(MAX_KARAT);
  const canPrice = weightMg !== null && weightMg > 0n && hasKarat && maznehRial !== null && maznehRial > 0n;

  const priceRial = canPrice
    ? mulDivHalfUp(weightMg, gramRate(maznehRial, karat(toSafeNumber(karatValue))), 1000n)
    : null;

  return (
    <div
      className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border bg-muted px-3 py-2 text-sm"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="flex flex-wrap items-center gap-x-2 tabular-nums text-muted-foreground">
        {weightMg !== null && weightMg > 0n ? (
          <span>
            <bdi className="font-semibold text-foreground">{formatGram(weightMg)}</bdi> گرم
          </span>
        ) : null}
        {hasKarat ? (
          <span>
            · عیار <bdi className="font-semibold text-foreground">{formatKarat(toSafeNumber(karatValue))}</bdi>
          </span>
        ) : null}
      </span>

      {priceRial !== null ? (
        <span className="tabular-nums">
          <bdi className="text-base font-bold text-primary">{formatRial(priceRial)}</bdi>{' '}
          <span className="text-xs text-muted-foreground">ریال</span>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">وزن، عیار و مظنه را وارد کنید</span>
      )}
    </div>
  );
}
