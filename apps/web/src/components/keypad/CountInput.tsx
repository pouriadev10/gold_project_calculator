import { NumericField } from './NumericField';

/**
 * ورودی شمارشی صحیح — پوسته‌ی نازک روی `NumericField kind="count"`.
 *
 * برای هر چیزی که «تعداد» است، نه وزن یا مبلغ: تعداد سکه، تعداد قطعه‌ی
 * زیورآلات در موجودی افتتاحیه (FE-039). کیپد کلید منفی ندارد و
 * `DIGIT_SPECS.count` خودش `decimals: 0` است، پس هیچ اعتبارسنجی محدوده‌ای
 * لازم نیست — برخلاف `KaratInput` که سقف ۱۰۰۰ دارد و برای آن باید مقدار
 * زنده را برای محاسبه‌ی خطا جدا نگه دارد، اینجا هر عدد صحیح نامنفی معتبر
 * است، پس نیازی به state محلی یا `useEffect` هم‌گام‌سازی نیست —
 * `NumericField` خودش تنها منبع حقیقت مقدار است.
 */

export interface CountInputProps {
  label: string;
  value?: bigint;
  onChange?: (value: bigint) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}

export function CountInput({ label, value, onChange, error, hint, disabled, className }: CountInputProps) {
  return (
    <NumericField
      kind="count"
      label={label}
      {...(value !== undefined && { value })}
      {...(onChange !== undefined && { onChange })}
      {...(error !== undefined && { error })}
      {...(hint !== undefined && { hint })}
      {...(disabled !== undefined && { disabled })}
      {...(className !== undefined && { className })}
    />
  );
}
