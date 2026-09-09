import { dualFromRial, formatGram } from '@gold/core-calc';
import type { SecondHandGoldPurchase } from '@gold/contracts';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { Card } from '@/components/ui/card';

export function PurchaseReceipt({ receipt }: { receipt: SecondHandGoldPurchase }) {
  const rows = [
    ['مبلغ خرید', receipt.grossPurchaseAmountRial], ['کارمزد', receipt.feeRial],
    ['مبلغ نهایی', receipt.finalAmountRial], ['پرداخت‌شده', receipt.paidRial],
    ['مانده بستانکاری فروشنده', receipt.payableRial],
  ] as const;
  return (
    <Card className="space-y-4 p-4" aria-label="رسید خرید">
      <h2 className="text-lg font-semibold text-credit" role="status">خرید ثبت شد</h2>
      <p className="text-sm">طلای خالص به موجودی آبشده اضافه شد.</p>
      <dl className="space-y-3 text-sm">
        <div><dt>شناسه خرید</dt><dd className="break-all" dir="ltr">{receipt.secondHandPurchaseId}</dd></div>
        <div><dt>وزن خالص ثبت‌شده</dt><dd>{formatGram(BigInt(receipt.pureWeightMg))} گرم</dd></div>
        {rows.map(([label, value]) => <div key={label} className="flex flex-wrap items-center justify-between gap-2">
          <dt>{label}</dt><dd><AmountDisplay amount={dualFromRial(BigInt(value), BigInt(receipt.goldRatePerGramRial))} /></dd>
        </div>)}
      </dl>
    </Card>
  );
}
