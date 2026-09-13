import { Link } from '@tanstack/react-router';
import { CheckCircle2, FileText } from 'lucide-react';
import { dualFromRial, formatGram } from '@gold/core-calc';
import type { B2cBuyback } from '@gold/contracts';
import { AmountDisplay, RateDisplay } from '@/components/common/AmountDisplay';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function B2cBuybackReceipt({ receipt }: { readonly receipt: B2cBuyback }) {
  const goldRate = BigInt(receipt.goldRatePerGramRial);
  const purchaseAmount = BigInt(receipt.breakdown.todayPurchaseAmountRial);
  const paid = BigInt(receipt.paidRial);
  const payable = BigInt(receipt.payableRial);
  const documentAnchor = `buyback-document-${receipt.secondHandPurchaseId}`;

  return (
    <Card id={documentAnchor} aria-labelledby="b2c-buyback-receipt-title">
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <CheckCircle2 className="size-5 text-credit" aria-hidden="true" />
        <CardTitle id="b2c-buyback-receipt-title" className="text-base text-credit" role="status">
          خرید طلای دست‌دوم ثبت شد
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-6">
          یک سند خرید جدید ساخته شد و طلای خالص به موجودی آبشده اضافه شد. فاکتور فروش مرجع بدون
          تغییر باقی مانده است.
        </p>

        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">شناسه سند خرید جدید</dt>
            <dd className="break-all font-medium" dir="ltr">
              {receipt.secondHandPurchaseId}
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-muted-foreground">وزن خالص ثبت‌شده</dt>
            <dd className="tabular-nums font-semibold">
              {formatGram(BigInt(receipt.pureWeightMg))} گرم
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-muted-foreground">مبلغ خرید امروز</dt>
            <dd>
              <AmountDisplay amount={dualFromRial(purchaseAmount, goldRate)} />
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-muted-foreground">پرداخت‌شده</dt>
            <dd>
              <AmountDisplay amount={dualFromRial(paid, goldRate)} />
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-muted-foreground">مانده بستانکاری مشتری</dt>
            <dd>
              <AmountDisplay amount={dualFromRial(payable, goldRate)} />
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-muted-foreground">نرخ قفل‌شده سند</dt>
            <dd>
              <RateDisplay value={goldRate} size="sm" />
            </dd>
          </div>
        </dl>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button asChild variant="outline">
            <a href={`#${documentAnchor}`} aria-label="لینک به سند خرید جدید">
              <FileText aria-hidden="true" />
              لینک سند جدید
            </a>
          </Button>
          <Button asChild variant="outline">
            <Link to="/sales/invoices/$invoiceId" params={{ invoiceId: receipt.sourceInvoiceId }}>
              مشاهده فاکتور مرجع
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
