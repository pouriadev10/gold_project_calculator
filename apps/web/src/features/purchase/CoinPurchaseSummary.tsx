import { bubble, coinPositionValue, dualFromRial, formatCoinCount, intrinsicValue, rial, type CoinType } from '@gold/core-calc';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface CoinPurchaseSummaryProps { coin: CoinType; countBefore: number; countPurchased: number; purchaseUnitPriceRial: bigint; rate1000: bigint | undefined; }

export function CoinPurchaseSummary({ coin, countBefore, countPurchased, purchaseUnitPriceRial, rate1000 }: CoinPurchaseSummaryProps) {
  const countAfter = countBefore + countPurchased;
  const purchaseAmount = countPurchased > 0 && purchaseUnitPriceRial > 0n ? coinPositionValue(countPurchased, rial(purchaseUnitPriceRial)) : undefined;
  const intrinsicAmount = countPurchased > 0 && rate1000 !== undefined ? coinPositionValue(countPurchased, intrinsicValue(coin, rial(rate1000))) : undefined;
  const bubbleAmount = !coin.isCentralBankMinted ? null : countPurchased > 0 && rate1000 !== undefined && purchaseUnitPriceRial > 0n ? coinPositionValue(countPurchased, bubble(coin, rial(purchaseUnitPriceRial), rial(rate1000))) : undefined;
  return <Card aria-label={`خلاصه خرید ${coin.label}`}><CardHeader><CardTitle className="text-sm">خلاصه خرید {coin.label}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
    <div className="grid grid-cols-3 gap-2 text-center">
      <div><p className="text-xs text-muted-foreground">تعداد قبل</p><p className="font-medium tabular-nums">{formatCoinCount(countBefore)}</p></div>
      <div><p className="text-xs text-muted-foreground">تعداد خرید</p><p className="font-medium tabular-nums">{formatCoinCount(countPurchased)}</p></div>
      <div><p className="text-xs text-muted-foreground">تعداد بعد</p><p className="font-medium tabular-nums">{formatCoinCount(countAfter)}</p></div>
    </div>
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">مبلغ خرید</span>{purchaseAmount !== undefined && rate1000 !== undefined ? <AmountDisplay amount={dualFromRial(purchaseAmount, rate1000)} size="sm" /> : <span>—</span>}</div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">ارزش ذاتی</span>
        {rate1000 === undefined ? (
          <span className="text-xs text-muted-foreground">مظنه در دسترس نیست</span>
        ) : intrinsicAmount !== undefined ? (
          <AmountDisplay amount={dualFromRial(intrinsicAmount, rate1000)} size="sm" />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
      {coin.isCentralBankMinted ? <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">حباب خرید</span>{bubbleAmount !== undefined && bubbleAmount !== null && rate1000 !== undefined ? <AmountDisplay amount={dualFromRial(bubbleAmount, rate1000)} signed size="sm" /> : <span className="text-xs text-muted-foreground">نرخ خرید را وارد کنید</span>}</div> : null}
    </div>
  </CardContent></Card>;
}
