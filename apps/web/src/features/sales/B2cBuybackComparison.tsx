import { Info } from 'lucide-react';
import { dualFromRial, type DualAmount } from '@gold/core-calc';
import type { B2cBuybackComparisonEvent, B2cBuybackPreview } from '@gold/contracts';
import { AmountDisplay, RateDisplay } from '@/components/common/AmountDisplay';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatJalaliDateTime } from '@/lib/date';

/**
 * تبدیل صرفاً نمایشی یک مبلغِ wire-format به `DualAmount`.
 *
 * هر طرف مقایسه نرخ قفل‌شده‌ی خودش را دارد؛ بنابراین تاریخچه هیچ‌وقت با
 * مظنه‌ی امروز بازنویسی نمی‌شود. اثرهای اختلاف به نرخ خرید امروز نمایش
 * داده می‌شوند تا در حالت «طلا» معادل قابل‌فهمِ همان نتیجه‌ی نهایی باشند.
 */
function displayAmount(amountRial: string, goldRatePerGramRial: string): DualAmount {
  return dualFromRial(BigInt(amountRial), BigInt(goldRatePerGramRial));
}

function EventDetails({
  event,
  title,
  amountLabel,
}: {
  readonly event: B2cBuybackComparisonEvent;
  readonly title: string;
  readonly amountLabel: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-muted/30 p-4" aria-label={title}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <dl className="mt-3 space-y-3 text-sm">
        <div className="flex items-start justify-between gap-4">
          <dt className="text-muted-foreground">تاریخ رویداد</dt>
          <dd className="shrink-0 tabular-nums">
            {formatJalaliDateTime(new Date(event.effectiveAt))}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-4">
          <dt className="text-muted-foreground">زمان ثبت مظنه</dt>
          <dd className="shrink-0 tabular-nums">
            {formatJalaliDateTime(new Date(event.quoteObservedAt))}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">مظنه‌ی قفل‌شده</dt>
          <dd className="shrink-0">
            <RateDisplay value={BigInt(event.quoteAmountRial)} size="sm" />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">نرخ هر گرم طلای ۱۰۰۰</dt>
          <dd className="shrink-0">
            <RateDisplay value={BigInt(event.goldRatePerGramRial)} size="sm" />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
          <dt className="font-medium">{amountLabel}</dt>
          <dd className="shrink-0">
            <AmountDisplay
              amount={displayAmount(event.purchaseAmountRial, event.goldRatePerGramRial)}
              size="sm"
            />
          </dd>
        </div>
      </dl>
    </section>
  );
}

function DifferenceRow({
  label,
  amountRial,
  goldRatePerGramRial,
}: {
  readonly label: string;
  readonly amountRial: string;
  readonly goldRatePerGramRial: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {/* مثبت/منفی بودن نتیجه‌ی تجاری است، نه وضعیت خطا؛ عمداً رنگ خطا نمی‌گیرد. */}
      <AmountDisplay amount={displayAmount(amountRial, goldRatePerGramRial)} size="sm" />
    </div>
  );
}

/**
 * خروجی قطعی endpoint preview برای Buyback B2C.
 *
 * این کامپوننت هیچ محاسبه‌ی دامنه‌ای انجام نمی‌دهد؛ backend تنها مرجعِ
 * breakdown است. بنابراین با تغییر مظنه‌ی زنده یا ورود دوباره‌ی صفحه،
 * نتایج یک پیش‌نمایش قبلی بی‌صدا تغییر نمی‌کنند.
 */
export function B2cBuybackComparison({ preview }: { readonly preview: B2cBuybackPreview }) {
  const rateForDifference = preview.today.goldRatePerGramRial;
  const wageBurnedAsDifference = (-BigInt(preview.breakdown.wageBurnedRial)).toString();

  return (
    <Card aria-labelledby="b2c-buyback-comparison-title">
      <CardHeader>
        <CardTitle id="b2c-buyback-comparison-title" className="text-base">
          مقایسه‌ی خرید اولیه و خرید امروز
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-2">
          <EventDetails event={preview.original} title="خرید اولیه" amountLabel="مبلغ خرید اولیه" />
          <EventDetails event={preview.today} title="خرید امروز" amountLabel="مبلغ پرداختی امروز" />
        </div>

        <section aria-labelledby="b2c-buyback-breakdown-title">
          <h3 id="b2c-buyback-breakdown-title" className="text-sm font-semibold">
            منشأ تفاوت
          </h3>
          <div className="mt-2 divide-y divide-border rounded-lg border border-border px-3">
            <DifferenceRow
              label="اجرت سوخته"
              amountRial={wageBurnedAsDifference}
              goldRatePerGramRial={rateForDifference}
            />
            <DifferenceRow
              label="اختلاف عیار"
              amountRial={preview.breakdown.karatDifferenceRial}
              goldRatePerGramRial={rateForDifference}
            />
            <DifferenceRow
              label="تغییر مظنه"
              amountRial={preview.breakdown.marketPriceDifferenceRial}
              goldRatePerGramRial={rateForDifference}
            />
            <DifferenceRow
              label="سایر اختلافات محاسبه"
              amountRial={preview.breakdown.otherCalculationDifferenceRial}
              goldRatePerGramRial={rateForDifference}
            />
          </div>
        </section>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <span className="font-semibold">نتیجه نهایی</span>
          <AmountDisplay
            amount={displayAmount(preview.breakdown.differenceRial, rateForDifference)}
            size="lg"
          />
        </div>

        <p className="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground" role="note">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          مبلغ خرید امروز ممکن است کمتر یا بیشتر از خرید اولیه باشد؛ این تفاوت طبیعی است و خطا نیست.
        </p>
      </CardContent>
    </Card>
  );
}
