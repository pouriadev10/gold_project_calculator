import { useCallback, useEffect, useState } from 'react';
import { formatGram, grossMg, karat as toKarat, toPureMg, toSafeNumber } from '@gold/core-calc';
import { NumericField } from './NumericField';

/**
 * ورودی وزن — پوسته‌ی نازک روی `NumericField kind="weight"`.
 *
 * چرا کسورات (نگین، سایر) اینجا نیست: آن‌ها دغدغه‌ی فرم کالای زیورآلات
 * (FE-037) هستند، نه این کامپوننت پایه. اینجا فقط «یک وزن، با عیار
 * اختیاری برای پیش‌نمایش وزن خالص» است — تا در فرم‌های دیگر (خرید
 * دست‌دوم بدون کسورات، تسویه با طلا، موجودی افتتاحیه) هم مستقیم
 * قابل‌استفاده بماند.
 *
 * چرا `karat` را خودش رندر نمی‌کند: عیار معمولاً یک فیلد جداست (گاهی از
 * کاتالوگ کالا می‌آید، نه از تایپ کاربر). این کامپوننت فقط مقدار عیارِ
 * از بیرون را برای **نمایش** وزن خالص می‌گیرد؛ فیلد عیار مسئولیت خودش
 * را جای دیگری دارد.
 */

export interface WeightInputProps {
  label: string;
  /** وزن ناخالص، میلی‌گرم — همان چیزی که مستقیم قابل ذخیره‌سازی است. */
  value?: bigint;
  onChange?: (value: bigint) => void;
  /** عیار برای پیش‌نمایش وزن خالص. بدون آن یا خارج از بازه‌ی معتبر، پیش‌نمایش نشان داده نمی‌شود. */
  karat?: bigint;
  error?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}

/** وزن خالص را فقط وقتی وزن و عیار هر دو معنادارند محاسبه می‌کند؛ در غیر این صورت چیزی نمایش داده نمی‌شود. */
function pureWeightPreview(grossWeightMg: bigint, karatValue: bigint | undefined): bigint | undefined {
  if (grossWeightMg <= 0n) return undefined;
  if (karatValue === undefined || karatValue < 1n || karatValue > 1000n) return undefined;

  return toPureMg(grossMg(grossWeightMg), toKarat(toSafeNumber(karatValue)));
}

export function WeightInput({
  label,
  value,
  onChange,
  karat,
  error,
  hint,
  disabled,
  className,
}: WeightInputProps) {
  /**
   * چرا یک کپی داخلی از مقدار لازم است: بدون `onChange` بیرونی،
   * `NumericField` کاملاً uncontrolled کار می‌کند و مقدار واقعی فقط
   * داخل استور مشترک کیپد می‌ماند (زیر یک `id` داخلی که این کامپوننت
   * اصلاً نمی‌بیند). بدون این کپی، پیش‌نمایش وزن خالص هرگز از صفر
   * جلوتر نمی‌رفت، چون هیچ‌وقت مقدار تازه‌ی تایپ‌شده را نمی‌دید.
   */
  const [liveValue, setLiveValue] = useState(value ?? 0n);

  useEffect(() => {
    if (value !== undefined) setLiveValue(value);
  }, [value]);

  const handleChange = useCallback(
    (next: bigint) => {
      setLiveValue(next);
      onChange?.(next);
    },
    [onChange],
  );

  const pureMgValue = pureWeightPreview(liveValue, karat);

  return (
    <div className="flex flex-col gap-1">
      <NumericField
        kind="weight"
        label={label}
        {...(value !== undefined && { value })}
        onChange={handleChange}
        {...(error !== undefined && { error })}
        {...(hint !== undefined && { hint })}
        {...(disabled !== undefined && { disabled })}
        {...(className !== undefined && { className })}
      />
      {pureMgValue !== undefined ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          وزن خالص: {formatGram(pureMgValue)}
        </p>
      ) : null}
    </div>
  );
}
