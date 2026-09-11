import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { FileText, Info, Loader2, RotateCcw } from 'lucide-react';
import { formatCount, toSafeNumber } from '@gold/core-calc';
import type { B2cBuybackPreview } from '@gold/contracts';
import { previewB2cBuyback } from '@/api/purchase';
import { useInvoiceVersions } from '@/api/queries';
import { RateDisplay } from '@/components/common/AmountDisplay';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { PageHeader } from '@/components/common/PageHeader';
import { UnitToggle } from '@/components/common/UnitToggle';
import { KaratInput } from '@/components/keypad/KaratInput';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { WeightInput } from '@/components/keypad/WeightInput';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMazneh } from '@/features/home/useMazneh';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { formatJalaliDateTime } from '@/lib/date';
import { B2cBuybackComparison } from './B2cBuybackComparison';

/**
 * مقایسه‌ی Buyback B2C — FE-062.
 *
 * کاربر وزنِ اندازه‌گیری‌شده‌ی امروز را وارد می‌کند و فقط یک preview از
 * backend می‌گیرد. این صفحه به‌عمد پرداخت، idempotency و ثبت خرید ندارد؛
 * آن‌ها مسئولیت FE-063 هستند. فروش قبلی هم به هیچ شکل معکوس یا ویرایش
 * نمی‌شود: فاکتور صرفاً مرجعِ فقط‌خواندنیِ خرید دست‌دوم جدید است.
 */
export default function B2cBuybackStartPage() {
  const { invoiceId } = useParams({ from: '/app-shell/sales/invoices/$invoiceId/b2c-buyback' });
  const isOnline = useOnlineStatus();
  const invoice = useInvoiceVersions(invoiceId);
  const mazneh = useMazneh();

  const [grossWeightMg, setGrossWeightMg] = useState(0n);
  const [stoneWeightMg, setStoneWeightMg] = useState(0n);
  const [otherDeductionWeightMg, setOtherDeductionWeightMg] = useState(0n);
  const [purchaseKarat, setPurchaseKarat] = useState(0n);
  const [preview, setPreview] = useState<B2cBuybackPreview | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const deductionWeightMg = stoneWeightMg + otherDeductionWeightMg;
  const invalidDeductions = grossWeightMg > 0n && deductionWeightMg >= grossWeightMg;
  const hasQuote = mazneh.data !== null && mazneh.data !== undefined;
  const canPreview =
    isOnline &&
    hasQuote &&
    !invoice.isLoading &&
    !invoice.isError &&
    grossWeightMg > 0n &&
    !invalidDeductions &&
    !isPreviewing;

  function invalidatePreview() {
    setPreview(null);
    setPreviewError(null);
  }

  async function requestPreview() {
    if (!canPreview || !mazneh.data) return;

    setIsPreviewing(true);
    setPreviewError(null);

    try {
      const nextPreview = await previewB2cBuyback(invoiceId, {
        grossWeightMg: grossWeightMg.toString(),
        stoneWeightMg: stoneWeightMg.toString(),
        otherDeductionWeightMg: otherDeductionWeightMg.toString(),
        ...(purchaseKarat > 0n ? { purchaseKarat: toSafeNumber(purchaseKarat) } : {}),
        quoteId: mazneh.data.quoteId,
        effectiveAt: new Date().toISOString(),
      });
      setPreview(nextPreview);
    } catch (error: unknown) {
      setPreview(null);
      setPreviewError(error);
    } finally {
      setIsPreviewing(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="مقایسه خرید مجدد مشتری">
        <UnitToggle />
      </PageHeader>

      <main className="flex-1 space-y-4 p-4 pb-action">
        <Card aria-label="ماهیت خرید مجدد">
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <RotateCcw className="size-5 text-primary" aria-hidden="true" />
            <CardTitle className="text-sm">خرید طلای دست‌دوم</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6">
            <p>
              این عملیات یک خرید طلای دست‌دوم از مشتری است؛ فروش قبلی را برنمی‌گرداند و هیچ تغییری
              در فاکتور اصلی ایجاد نمی‌کند.
            </p>
            <p className="text-muted-foreground">
              اینجا فقط مقایسه را می‌بینید. ثبت خرید و پرداخت، پس از تأیید شما در گام بعد انجام
              می‌شود.
            </p>
          </CardContent>
        </Card>

        <Card aria-label="فاکتور فروش مرجع">
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <FileText className="size-5 text-muted-foreground" aria-hidden="true" />
            <CardTitle className="text-sm">فاکتور فروش مرجع</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {invoice.isLoading ? (
              <div className="space-y-3" aria-label="در حال دریافت فاکتور مرجع">
                <div className="h-4 w-full animate-pulse rounded bg-muted" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              </div>
            ) : invoice.isError ? (
              <ApiErrorNotice error={invoice.error} />
            ) : invoice.data ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">شماره فاکتور</span>
                <span className="tabular-nums font-semibold">
                  {formatCount(invoice.data.invoiceNumber)}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">شناسه فاکتور</span>
                <span className="min-w-0 truncate font-medium" dir="ltr">
                  {invoiceId}
                </span>
              </div>
            )}
            <p
              className="flex items-start gap-1.5 border-t border-border pt-3 text-xs leading-5 text-muted-foreground"
              role="note"
            >
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              فاکتور فقط مرجع خرید جدید است؛ مبلغ و شرایط فروش اولیه در آن ویرایش نمی‌شوند.
            </p>
          </CardContent>
        </Card>

        <Card aria-label="اندازه‌گیری امروز">
          <CardHeader>
            <CardTitle className="text-sm">اندازه‌گیری امروز</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <WeightInput
              label="وزن ناخالص"
              value={grossWeightMg}
              {...(purchaseKarat > 0n && { karat: purchaseKarat })}
              onChange={(value) => {
                setGrossWeightMg(value);
                invalidatePreview();
              }}
              hint="وزن کالای تحویلی امروز را وارد کنید."
            />
            <WeightInput
              label="وزن نگین"
              value={stoneWeightMg}
              onChange={(value) => {
                setStoneWeightMg(value);
                invalidatePreview();
              }}
              hint="اگر نگین ندارد، صفر بگذارید."
            />
            <WeightInput
              label="سایر کسورات وزن"
              value={otherDeductionWeightMg}
              {...(invalidDeductions && { error: 'مجموع کسورات باید از وزن ناخالص کمتر باشد.' })}
              onChange={(value) => {
                setOtherDeductionWeightMg(value);
                invalidatePreview();
              }}
              hint="مثلاً نخ یا بخش غیرطلایی؛ در غیر این صورت صفر."
            />
            <KaratInput
              label="عیار خرید امروز"
              value={purchaseKarat}
              onChange={(value) => {
                setPurchaseKarat(value);
                invalidatePreview();
              }}
              hint="خالی بگذارید تا عیار خرید دست‌دومِ تنظیم‌شده برای فروشگاه اعمال شود."
            />
          </CardContent>
        </Card>

        <Card aria-label="نرخ امروز">
          <CardHeader>
            <CardTitle className="text-sm">نرخ امروز برای مقایسه</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {mazneh.isLoading ? (
              <div
                className="h-5 w-2/3 animate-pulse rounded bg-muted"
                aria-label="در حال دریافت مظنه امروز"
              />
            ) : mazneh.isError ? (
              <ApiErrorNotice error={mazneh.error} />
            ) : mazneh.data ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">مظنه‌ی امروز</span>
                  <RateDisplay value={mazneh.data.mazneh} size="sm" />
                </div>
                <p className="tabular-nums text-xs text-muted-foreground">
                  ثبت‌شده در {formatJalaliDateTime(mazneh.data.observedAt)}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground" role="status">
                برای مقایسه، ابتدا مظنه‌ی امروز را ثبت کنید.
              </p>
            )}
          </CardContent>
        </Card>

        {!isOnline ? (
          <p className="text-sm text-muted-foreground" role="status">
            برای گرفتن مقایسه به اینترنت متصل شوید.
          </p>
        ) : null}
        {previewError ? <ApiErrorNotice error={previewError} /> : null}
        {preview ? <B2cBuybackComparison preview={preview} /> : null}
      </main>

      {/* اقدام فقط preview است؛ این صفحه به‌عمد هیچ خرید یا پرداختی ثبت نمی‌کند. */}
      <div className="fixed inset-x-0 bottom-above-nav z-20 border-t border-border bg-background px-4 py-3 lg:static lg:border-0 lg:px-4 lg:pb-4">
        <Button
          type="button"
          size="action"
          disabled={!canPreview}
          onClick={() => void requestPreview()}
          aria-busy={isPreviewing}
        >
          {isPreviewing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {isPreviewing ? 'در حال محاسبه...' : preview ? 'به‌روزرسانی مقایسه' : 'نمایش مقایسه'}
        </Button>
      </div>

      <NumericKeypad />
    </div>
  );
}
