import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { FileText, Info, Loader2, RotateCcw } from 'lucide-react';
import { dualFromRial, formatCount, toSafeNumber } from '@gold/core-calc';
import type { B2cBuybackPreview, PreviewB2cBuybackInput } from '@gold/contracts';
import { previewB2cBuyback } from '@/api/purchase';
import { useInvoiceVersions } from '@/api/queries';
import { AmountDisplay, RateDisplay } from '@/components/common/AmountDisplay';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { PageHeader } from '@/components/common/PageHeader';
import { UnitToggle } from '@/components/common/UnitToggle';
import { KaratInput } from '@/components/keypad/KaratInput';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { MoneyInput } from '@/components/keypad/MoneyInput';
import { WeightInput } from '@/components/keypad/WeightInput';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMazneh } from '@/features/home/useMazneh';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { formatJalaliDateTime } from '@/lib/date';
import { B2cBuybackComparison } from './B2cBuybackComparison';
import { B2cBuybackReceipt } from './B2cBuybackReceipt';
import { useB2cBuybackSubmit } from './useB2cBuybackSubmit';

/**
 * مقایسه و ثبت Buyback B2C — FE-062 / FE-063.
 *
 * کاربر وزنِ اندازه‌گیری‌شده‌ی امروز را وارد می‌کند و فقط یک preview از
 * backend می‌گیرد؛ سپس همان snapshot را با پرداخت و کلید idempotency به
 * یک سند خرید تازه تبدیل می‌کند. فروش قبلی به هیچ شکل معکوس یا ویرایش
 * نمی‌شود: فاکتور صرفاً مرجعِ فقط‌خواندنیِ خرید دست‌دوم جدید است.
 */
export default function B2cBuybackStartPage() {
  const { invoiceId } = useParams({ from: '/app-shell/sales/invoices/$invoiceId/b2c-buyback' });
  const isOnline = useOnlineStatus();
  const invoice = useInvoiceVersions(invoiceId);
  const mazneh = useMazneh();
  const submission = useB2cBuybackSubmit(invoiceId, isOnline);

  const [grossWeightMg, setGrossWeightMg] = useState(0n);
  const [stoneWeightMg, setStoneWeightMg] = useState(0n);
  const [otherDeductionWeightMg, setOtherDeductionWeightMg] = useState(0n);
  const [purchaseKarat, setPurchaseKarat] = useState(0n);
  const [preview, setPreview] = useState<B2cBuybackPreview | null>(null);
  const [previewInput, setPreviewInput] = useState<PreviewB2cBuybackInput | null>(null);
  const [paidRial, setPaidRial] = useState(0n);
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
  const purchaseAmountRial = preview ? BigInt(preview.breakdown.todayPurchaseAmountRial) : 0n;
  const overpaid = paidRial > purchaseAmountRial;
  const locked = isPreviewing || submission.isSubmitting || submission.attempt !== null;
  const canSubmit =
    isOnline && preview !== null && previewInput !== null && !overpaid && !submission.isSubmitting;

  function invalidatePreview() {
    setPreview(null);
    setPreviewInput(null);
    setPaidRial(0n);
    setPreviewError(null);
  }

  async function requestPreview() {
    if (!canPreview || !mazneh.data) return;

    setIsPreviewing(true);
    setPreviewError(null);

    try {
      const input: PreviewB2cBuybackInput = {
        grossWeightMg: grossWeightMg.toString(),
        stoneWeightMg: stoneWeightMg.toString(),
        otherDeductionWeightMg: otherDeductionWeightMg.toString(),
        ...(purchaseKarat > 0n ? { purchaseKarat: toSafeNumber(purchaseKarat) } : {}),
        quoteId: mazneh.data.quoteId,
        effectiveAt: new Date().toISOString(),
      };
      const nextPreview = await previewB2cBuyback(invoiceId, input);
      setPreview(nextPreview);
      setPreviewInput(input);
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
        {submission.receipt ? (
          <B2cBuybackReceipt receipt={submission.receipt} />
        ) : (
          <>
            <Card aria-label="ماهیت خرید مجدد">
              <CardHeader className="flex-row items-center gap-2 space-y-0">
                <RotateCcw className="size-5 text-primary" aria-hidden="true" />
                <CardTitle className="text-sm">خرید طلای دست‌دوم</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm leading-6">
                <p>
                  این عملیات یک خرید طلای دست‌دوم از مشتری است؛ فروش قبلی را برنمی‌گرداند و هیچ
                  تغییری در فاکتور اصلی ایجاد نمی‌کند.
                </p>
                <p className="text-muted-foreground">
                  ابتدا مقایسه را ببینید؛ سپس پرداخت را مشخص و سند خرید جدید را ثبت کنید.
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

            <fieldset disabled={locked} className="min-w-0 space-y-4">
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
                    {...(invalidDeductions && {
                      error: 'مجموع کسورات باید از وزن ناخالص کمتر باشد.',
                    })}
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
            </fieldset>

            {!isOnline ? (
              <p className="text-sm text-muted-foreground" role="status">
                برای گرفتن مقایسه به اینترنت متصل شوید.
              </p>
            ) : null}
            {previewError ? <ApiErrorNotice error={previewError} /> : null}
            {preview ? (
              <>
                <B2cBuybackComparison preview={preview} />
                <Card aria-label="پرداخت خرید مجدد">
                  <CardHeader>
                    <CardTitle className="text-sm">پرداخت به مشتری</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">مبلغ خرید امروز</span>
                      <AmountDisplay
                        amount={dualFromRial(
                          purchaseAmountRial,
                          BigInt(preview.today.goldRatePerGramRial),
                        )}
                      />
                    </div>
                    <MoneyInput
                      label="پرداخت اکنون (ریال)"
                      value={paidRial}
                      disabled={locked}
                      onChange={setPaidRial}
                      {...(overpaid
                        ? { error: 'پرداخت نمی‌تواند بیشتر از مبلغ خرید امروز باشد.' }
                        : {})}
                      hint="مبلغ پرداخت‌نشده به‌عنوان بستانکاری مشتری ثبت می‌شود."
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={locked}
                      onClick={() => setPaidRial(purchaseAmountRial)}
                    >
                      پرداخت کامل
                    </Button>
                    {!overpaid ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">مانده بستانکاری مشتری</span>
                        <AmountDisplay
                          amount={dualFromRial(
                            purchaseAmountRial - paidRial,
                            BigInt(preview.today.goldRatePerGramRial),
                          )}
                        />
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </>
            ) : null}
            {submission.attempt && !submission.isSubmitting ? (
              <p className="text-sm text-warning" role="status">
                نتیجه درخواست قبلی مشخص نیست؛ همان خرید با همان شناسه دوباره بررسی می‌شود.
              </p>
            ) : null}
            {submission.error ? <ApiErrorNotice error={submission.error} /> : null}
          </>
        )}
      </main>

      {!submission.receipt ? (
        <div className="fixed inset-x-0 bottom-above-nav z-20 border-t border-border bg-background px-4 py-3 lg:static lg:border-0 lg:px-4 lg:pb-4">
          {submission.attempt && !previewInput ? (
            <Button
              type="button"
              size="action"
              disabled={!isOnline || submission.isSubmitting}
              onClick={() => void submission.submit(submission.attempt!.input)}
              aria-busy={submission.isSubmitting}
            >
              {submission.isSubmitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {submission.isSubmitting ? 'در حال بررسی...' : 'بررسی نتیجه خرید'}
            </Button>
          ) : preview && previewInput ? (
            <Button
              type="button"
              size="action"
              disabled={!canSubmit}
              onClick={() =>
                void submission.submit({
                  ...previewInput,
                  paidRial: paidRial.toString(),
                })
              }
              aria-busy={submission.isSubmitting}
            >
              {submission.isSubmitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {submission.isSubmitting
                ? 'در حال ثبت...'
                : submission.attempt
                  ? 'بررسی نتیجه خرید'
                  : 'ثبت سند خرید جدید'}
            </Button>
          ) : (
            <Button
              type="button"
              size="action"
              disabled={!canPreview}
              onClick={() => void requestPreview()}
              aria-busy={isPreviewing}
            >
              {isPreviewing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {isPreviewing ? 'در حال محاسبه...' : 'نمایش مقایسه'}
            </Button>
          )}
        </div>
      ) : null}

      <NumericKeypad />
    </div>
  );
}
