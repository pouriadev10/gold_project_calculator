import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { dualFromRial, formatCount, gramRate1000 } from '@gold/core-calc';
import { AmountDisplay, RateDisplay } from '@/components/common/AmountDisplay';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { SaleSubmitOutcome } from './useJewelryCashSaleSubmit';

/**
 * نتیجه‌ی ثبت فروش — FE-045.
 *
 * این **رسید کامل نیست**؛ رسید کار FE-046 است و از خودِ فاکتور ثبت‌شده
 * روی سرور خوانده می‌شود. اینجا فقط چیزی نشان داده می‌شود که پاسخ همین
 * ثبت برگردانده — شماره‌ی فاکتور و مبلغ ثبت‌شده — و «موفقیت» تنها پس از
 * رسیدن همین پاسخ رندر می‌شود، نه لحظه‌ای زودتر (قاعده‌ی صریح تسک).
 *
 * ⚠️ **مبلغ از سرور می‌آید، نه از محاسبه‌ی محلی.** `payableRial` مستقیم از
 * پاسخ خوانده می‌شود. اگر پیش‌نمایش کلاینت با آن نخوانده باشد — که ممکن
 * است، چون ویرایش‌های ردیف (FE-043) اصلاً در قرارداد ثبت جایی ندارند و
 * سرور از روی نسخه‌ی ثبت‌شده‌ی کالا قیمت می‌زند — اختلاف صریح نشان داده
 * می‌شود، نه اینکه یکی از دو عدد بی‌صدا برنده شود.
 *
 * نام مشتری و نرخ قفل‌شده از `outcome` می‌آیند (کپی‌شده در لحظه‌ی ثبت)، نه
 * از `sale-draft-store` — پیش‌نویس بلافاصله پس از موفقیت پاک می‌شود و
 * این کامپوننت بعد از آن رندر می‌گردد.
 */
export function SaleSubmitResult({ outcome }: { readonly outcome: SaleSubmitOutcome }) {
  const rate1000 = gramRate1000(BigInt(outcome.lockedMazneh.mazneh));

  return (
    <div className="space-y-4">
      <section role="status" className="flex items-start gap-3 rounded-xl border border-credit/40 bg-credit/10 p-4">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-credit" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <h2 className="text-sm font-bold text-credit">فروش با موفقیت ثبت شد</h2>
          <p className="text-sm text-muted-foreground">
            فاکتور شماره {formatCount(outcome.sale.invoiceNumber)} برای {outcome.party.displayName} صادر شد.
          </p>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">فاکتور ثبت‌شده</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">شماره فاکتور</span>
            <span className="tabular-nums text-base font-semibold">{formatCount(outcome.sale.invoiceNumber)}</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">مشتری</span>
            <span className="truncate text-sm font-medium">{outcome.party.displayName}</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">نرخ این فاکتور</span>
            <RateDisplay value={BigInt(outcome.lockedMazneh.mazneh)} size="sm" />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              مبلغ ثبت‌شده
              <Badge variant="outline">از سرور</Badge>
            </span>
            <AmountDisplay amount={dualFromRial(outcome.sale.payableRial, rate1000)} size="lg" />
          </div>

          {outcome.previewMismatchRial !== undefined ? (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              مبلغ نهایی سرور با پیش‌نمایش این صفحه یکی نیست؛ عدد بالا — همان که ثبت شده — معتبر است. سرور کالا
              را از روی مشخصات ثبت‌شده‌ی آن در انبار قیمت می‌زند، نه ویرایش‌های موقت ردیف.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">نمایش و چاپ رسید کامل در گام بعدی اضافه می‌شود.</p>
    </div>
  );
}
