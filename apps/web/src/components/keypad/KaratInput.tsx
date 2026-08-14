import { useCallback, useEffect, useState } from 'react';
import { NumericField } from './NumericField';

/**
 * ورودی عیار — پوسته‌ی نازک روی `NumericField kind="karat"`.
 *
 * چرا هیچ عدد پیش‌فرضی (۷۴۰، ۷۵۰، ...) اینجا هاردکد نیست: طبق CLAUDE.md
 * بخش ۳، عیار خرید دست‌دوم **قابل‌تنظیم هر مستأجر** است. این کامپوننت
 * فقط `value`ای را که از بیرون می‌آید نمایش می‌دهد — چه از تنظیمات واقعی
 * مستأجر (وقتی آن API ساخته شود)، چه از کاتالوگ کالا، چه هرجای دیگر.
 * کاربر همیشه می‌تواند این مقدار را دست بزند و تغییر دهد؛ این کامپوننت
 * هیچ فیلدی را فقط به‌خاطر داشتن پیش‌فرض قفل نمی‌کند.
 *
 * میان‌برهای ۷۴۰/۷۵۰/۹۰۰/۹۹۵ (و ۹۲۵) از `NumericKeypad`/`shortcuts.ts`
 * (FE-019) به ارث می‌رسند — این‌جا کاری برایشان لازم نیست.
 */

const MIN_KARAT = 1n;
const MAX_KARAT = 1000n;

export interface KaratInputProps {
  label: string;
  /** عیار — عدد صحیح بین ۱ و ۱۰۰۰. */
  value?: bigint;
  onChange?: (value: bigint) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * مقدار صفر «هنوز چیزی تایپ نشده» حساب می‌شود، نه خطا — فیلد دست‌نخورده
 * نباید بلافاصله قرمز شود. زیر صفر از مسیر تایپ اصلاً قابل‌تولید نیست
 * (کیپد کلید منفی ندارد)، پس تنها مرز واقعاً قابل‌نقض، سقف ۱۰۰۰ است.
 */
function karatRangeError(value: bigint): string | undefined {
  if (value === 0n) return undefined;
  if (value < MIN_KARAT || value > MAX_KARAT) {
    return 'عیار باید عددی صحیح بین ۱ و ۱۰۰۰ باشد';
  }
  return undefined;
}

export function KaratInput({
  label,
  value,
  onChange,
  error,
  hint,
  disabled,
  className,
}: KaratInputProps) {
  // همان الگوی WeightInput: بدون این، وقتی فراخوان‌کننده onChange نمی‌دهد
  // (رایج‌ترین حالت مصرف)، اعتبارسنجی داخلی هرگز مقدار تازه‌ی تایپ‌شده
  // را نمی‌بیند و همیشه روی مقدار اولیه گیر می‌کند.
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

  const effectiveError = error ?? karatRangeError(liveValue);

  return (
    <NumericField
      kind="karat"
      label={label}
      {...(value !== undefined && { value })}
      onChange={handleChange}
      {...(effectiveError !== undefined && { error: effectiveError })}
      {...(hint !== undefined && { hint })}
      {...(disabled !== undefined && { disabled })}
      {...(className !== undefined && { className })}
    />
  );
}
