import { NumericField } from './NumericField';

/**
 * ورودی مبلغ ریالی — پوسته‌ی نازک روی `NumericField kind="rial"`.
 *
 * قالب‌بندی نمایشی (فارسی، جداساز هزارگان) و مقدار واقعی همیشه از هم
 * جدا مانده‌اند: `NumericField` این را از FE-018 دارد (`data-value` لاتین
 * در برابر مقدار نمایشی فارسیِ گروه‌بندی‌شده). تنها چیزی که Money Input
 * اضافه می‌کند، `showClear` است — دکمه‌ی پاک‌کردن مستقیم روی فیلد،
 * چون برای مبلغ (برخلاف وزن یا عیار) اصلاح سریع یک رقم اشتباه خیلی
 * بیشتر پیش می‌آید.
 */

export interface MoneyInputProps {
  label: string;
  /** مبلغ ریالی — همان چیزی که مستقیم قابل ذخیره‌سازی و ارسال است. */
  value?: bigint;
  onChange?: (value: bigint) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}

export function MoneyInput({
  label,
  value,
  onChange,
  error,
  hint,
  disabled,
  className,
}: MoneyInputProps) {
  return (
    <NumericField
      kind="rial"
      label={label}
      showClear
      {...(value !== undefined && { value })}
      {...(onChange !== undefined && { onChange })}
      {...(error !== undefined && { error })}
      {...(hint !== undefined && { hint })}
      {...(disabled !== undefined && { disabled })}
      {...(className !== undefined && { className })}
    />
  );
}
