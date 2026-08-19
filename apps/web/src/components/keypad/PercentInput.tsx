import { NumericField } from './NumericField';

/**
 * ورودی درصد — پوسته‌ی نازک روی `NumericField kind="percent"` (FE-036).
 *
 * مقدار همیشه در مقیاس ×۱۰۰ صحیح است — یعنی «۷٫۵٪» به‌صورت `750n`
 * نگه‌داشته و ارسال می‌شود، دقیقاً همان قرارداد `PERCENT_X100` در
 * `jewelryWageTypeSchema` (`@gold/contracts`). نمایش («۷٫۵») و مقدار
 * واقعی مثل بقیه‌ی فیلدهای این خانواده از هم جدا می‌مانند.
 */

export interface PercentInputProps {
  label: string;
  /** درصد در مقیاس ×۱۰۰ — همان چیزی که مستقیم قابل ذخیره‌سازی و ارسال است. */
  value?: bigint;
  onChange?: (value: bigint) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}

export function PercentInput({
  label,
  value,
  onChange,
  error,
  hint,
  disabled,
  className,
}: PercentInputProps) {
  return (
    <NumericField
      kind="percent"
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
