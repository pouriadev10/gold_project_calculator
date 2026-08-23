import { bubble, coinPositionValue, dualFromRial, formatCount, intrinsicValue, rial, type CoinType } from '@gold/core-calc';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * خلاصه‌ی موقعیت سکه در معامله — FE-049.
 *
 * **گزارش خالص است**: فقط props می‌گیرد و JSX می‌دهد، هیچ query یا
 * storeای صدا نمی‌زند و چیزی را تغییر نمی‌دهد (قاعده‌ی «storage را تغییر
 * نمی‌دهد»). تعداد قبل/فروش/بعد و ارزش‌ها همه از بیرون می‌آیند —
 * `CoinSaleForm` (FE-048) با موجودی جاری و ورودی‌های فرم پر می‌کند.
 *
 * **هر نوع سکه مستقل است**: این کامپوننت هیچ مجموع بین‌نوعی نمی‌سازد —
 * هر نمونه دقیقاً یک `CoinType` می‌بیند. اگر جایی چند نوع کنار هم لازم
 * شد، همین کامپوننت چندبار (یک‌بار به‌ازای هر نوع) رندر می‌شود، نه یک
 * نسخه‌ی جمع‌زننده؛ جمع‌زدن تعداد سکه‌های نوع‌های مختلف بی‌معناست (بخش
 * ۲-۲ CLAUDE.md — سکه یک شیء شمارشی مستقل است، نه وزن قابل‌جمع).
 *
 * **ارزش‌ها روی تعداد فروش (`countSold`) حساب می‌شوند**، نه موجودی
 * باقی‌مانده — «موقعیت... در معامله» یعنی ارزش خودِ همین معامله: چقدر
 * از بازار گرفته می‌شود، چقدرش طلای خالص است، و چقدرش حباب. حباب فقط
 * برای سکه‌ی بانک مرکزی محاسبه می‌شود (قانون حباب، بخش ۲-۳)، دقیقاً با
 * همان امضای `bubble()` که نوع غیرمجاز را از کامپایل می‌اندازد.
 */
export interface CoinPositionSummaryProps {
  readonly coin: CoinType;
  readonly countBefore: number;
  readonly countSold: number;
  readonly marketUnitPriceRial: bigint;
  /** نرخ گرم طلای خالص ۱۰۰۰ — `undefined` یعنی مظنه هنوز در دسترس نیست. */
  readonly rate1000: bigint | undefined;
}

export function CoinPositionSummary({
  coin,
  countBefore,
  countSold,
  marketUnitPriceRial,
  rate1000,
}: CoinPositionSummaryProps) {
  const countAfter = countBefore - countSold;

  const marketValueRial = countSold > 0 && marketUnitPriceRial > 0n ? coinPositionValue(countSold, rial(marketUnitPriceRial)) : undefined;
  const intrinsicValueRial = countSold > 0 && rate1000 !== undefined ? coinPositionValue(countSold, intrinsicValue(coin, rial(rate1000))) : undefined;
  const bubbleRial =
    !coin.isCentralBankMinted
      ? null
      : countSold > 0 && rate1000 !== undefined && marketUnitPriceRial > 0n
        ? coinPositionValue(countSold, bubble(coin, rial(marketUnitPriceRial), rial(rate1000)))
        : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">خلاصه‌ی موقعیت {coin.label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xs text-muted-foreground">تعداد قبل</p>
            <p className="tabular-nums font-medium">{formatCount(countBefore)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">تعداد فروش</p>
            <p className="tabular-nums font-medium">{formatCount(countSold)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">تعداد بعد</p>
            <p className={`tabular-nums font-medium ${countAfter < 0 ? 'text-debit' : ''}`}>{formatCount(countAfter)}</p>
          </div>
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">ارزش بازار</span>
            {marketValueRial !== undefined && rate1000 !== undefined ? (
              <AmountDisplay amount={dualFromRial(marketValueRial, rate1000)} size="sm" />
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">ارزش ذاتی</span>
            {intrinsicValueRial !== undefined && rate1000 !== undefined ? (
              <AmountDisplay amount={dualFromRial(intrinsicValueRial, rate1000)} size="sm" />
            ) : (
              <span className="text-xs text-muted-foreground">مظنه در دسترس نیست</span>
            )}
          </div>
          {coin.isCentralBankMinted ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">حباب نمایشی</span>
              {bubbleRial !== undefined && bubbleRial !== null && rate1000 !== undefined ? (
                <AmountDisplay amount={dualFromRial(bubbleRial, rate1000)} signed size="sm" />
              ) : (
                <span className="text-xs text-muted-foreground">قیمت بازار را وارد کنید</span>
              )}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
