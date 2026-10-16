import { dualFromRial } from '@gold/core-calc';
import { AmountDisplay } from './AmountDisplay';

/**
 * مبلغ ریالی با نرخ اختیاری — FE-103/FE-104.
 *
 * با نرخ، چهره‌ی دومقیاسه از کلید سراسری واحد پیروی می‌کند؛ بدون نرخ فقط همان چهره‌ی ریالی خام
 * دیده می‌شود — معادل ساختگی ساخته نمی‌شود. برای مبلغ یک **سند ثبت‌شده** نرخ باید نرخ خودِ سند
 * باشد (`documentQuoteRate`)، نه مظنه‌ی زنده.
 */
export function RialAmount({
  value,
  rate1000,
  signed = false,
}: {
  value: bigint;
  rate1000: bigint | null | undefined;
  signed?: boolean;
}) {
  return (
    <AmountDisplay
      amount={
        rate1000 !== null && rate1000 !== undefined
          ? dualFromRial(value, rate1000)
          : { kind: 'raw', value, unit: 'rial' }
      }
      signed={signed}
      size="sm"
    />
  );
}
