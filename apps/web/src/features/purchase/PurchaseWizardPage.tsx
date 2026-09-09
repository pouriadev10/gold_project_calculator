import { useBlocker } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import { dualFromRial, toSafeNumber } from '@gold/core-calc';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { MoneyInput } from '@/components/keypad/MoneyInput';
import { PageHeader } from '@/components/common/PageHeader';
import { UnitToggle } from '@/components/common/UnitToggle';
import { Button } from '@/components/ui/button';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { MaznehBar } from '@/features/home/MaznehBar';
import { useMazneh } from '@/features/home/useMazneh';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import {
  hasPurchaseDraftProgress,
  NAVIGABLE_PURCHASE_STEPS,
  PURCHASE_STEPS,
  usePurchaseDraftStore,
} from '@/stores/purchase-draft-store';
import { PurchaseStepper } from './PurchaseStepper';
import { SecondHandWeighingForm } from './SecondHandWeighingForm';
import { calculateSecondHandWeighing } from './purchase-pricing';
import { SellerDetailsStep } from './SellerDetailsStep';
import { PurchaseReceipt } from './PurchaseReceipt';
import { usePurchaseSubmit } from './usePurchaseSubmit';

/**
 * صفحه‌ی خرید طلای دست‌دوم — shell و فرم وزن‌کشی جریان هشت‌مرحله‌ای (FE-056 / FE-057).
 *
 * **مستقل از ویزارد فروش** — قاعده‌ی صریح تسک: هیچ وابستگی‌ای به `features/sales` نیست.
 *
 * مراحل:
 * ۱. **فروشنده**: `PartySelector` با قفل برای همکاران (`CONSUMER` فقط).
 * ۲. **وزن‌کشی**: ورودی وزن ناخالص کل با `WeightInput`.
 * ۳. **کسورات**: ورودی وزن نگین و سایر متعلقات با پیش‌نمایش وزن خالص پیش از عیار.
 * ۴. **عیار**: انتخاب عیار خرید با پیش‌نمایش نرخ هر گرم عیار مربوطه.
 * ۵. **مظنه**: بررسی مظنه زنده با `MaznehBar`.
 * ۶. **مبلغ**: ورودی کارمزد اختیاری و پیش‌نمایش کامل مبالغ قبل و بعد از کارمزد و طلای خالص.
 * ۷. **پرداخت**: ثبت پرداخت و تسویه (FE-059).
 * ۸. **رسید**: نمایش رسید نهایی (FE-059).
 */

export default function PurchaseWizardPage() {
  const isOnline = useOnlineStatus();
  const mazneh = useMazneh();

  const step = usePurchaseDraftStore((s) => s.step);
  const seller = usePurchaseDraftStore((s) => s.seller);
  const grossWeightMg = usePurchaseDraftStore((s) => s.grossWeightMg);
  const stoneWeightMg = usePurchaseDraftStore((s) => s.stoneWeightMg);
  const otherDeductionWeightMg = usePurchaseDraftStore((s) => s.otherDeductionWeightMg);
  const purchaseKarat = usePurchaseDraftStore((s) => s.purchaseKarat);
  const feeRial = usePurchaseDraftStore((s) => s.feeRial);
  const paidRial = usePurchaseDraftStore((s) => s.paidRial);
  const setPaidRial = usePurchaseDraftStore((s) => s.setPaidRial);
  const submission = usePurchaseSubmit(mazneh.data?.quoteId, isOnline);
  const locked = submission.isSubmitting || submission.attempt !== null;

  const next = usePurchaseDraftStore((s) => s.next);
  const back = usePurchaseDraftStore((s) => s.back);
  const setSeller = usePurchaseDraftStore((s) => s.setSeller);
  const setGrossWeightMg = usePurchaseDraftStore((s) => s.setGrossWeightMg);
  const setStoneWeightMg = usePurchaseDraftStore((s) => s.setStoneWeightMg);
  const setOtherDeductionWeightMg = usePurchaseDraftStore((s) => s.setOtherDeductionWeightMg);
  const setPurchaseKarat = usePurchaseDraftStore((s) => s.setPurchaseKarat);
  const setFeeRial = usePurchaseDraftStore((s) => s.setFeeRial);

  useBlocker(() => true, !submission.receipt && hasPurchaseDraftProgress({ step, seller, grossWeightMg, feeRial }));

  const stepIndex = PURCHASE_STEPS.indexOf(step);
  const isFirstStep = stepIndex === 0;
  const isLastEntryStep = step === NAVIGABLE_PURCHASE_STEPS[NAVIGABLE_PURCHASE_STEPS.length - 1];
  const isNonConsumerSeller = seller !== null && seller.type !== 'CONSUMER';

  const maznehRial = mazneh.data?.mazneh ?? 0n;

  const grossWeightBigInt = BigInt(grossWeightMg || '0');
  const stoneWeightBigInt = BigInt(stoneWeightMg || '0');
  const otherDeductionWeightBigInt = BigInt(otherDeductionWeightMg || '0');
  const feeBigInt = BigInt(feeRial || '0');
  const totalDeductionsBigInt = stoneWeightBigInt + otherDeductionWeightBigInt;

  const weighingCalc = calculateSecondHandWeighing(
    {
      grossWeightMg,
      stoneWeightMg,
      otherDeductionWeightMg,
      purchaseKarat,
      feeRial,
    },
    maznehRial,
  );
  const paid = BigInt(paidRial || '0');
  const canSubmit = isOnline && !submission.isSubmitting && (submission.attempt !== null || (
    seller?.type === 'CONSUMER' && seller.status === 'ACTIVE' &&
    Boolean(mazneh.data) && weighingCalc.ok && paid >= 0n && paid <= weighingCalc.calc.finalAmountRial
  ));

  let canGoNext = false;
  if (step === 'SELLER') {
    canGoNext = seller !== null && !isNonConsumerSeller;
  } else if (step === 'WEIGHING') {
    canGoNext = grossWeightBigInt > 0n;
  } else if (step === 'DEDUCTIONS') {
    canGoNext = grossWeightBigInt > 0n && totalDeductionsBigInt < grossWeightBigInt;
  } else if (step === 'KARAT') {
    canGoNext = purchaseKarat >= 1 && purchaseKarat <= 1000;
  } else if (step === 'QUOTE') {
    canGoNext = Boolean(mazneh.data && maznehRial > 0n);
  } else if (step === 'AMOUNT') {
    canGoNext = weighingCalc.ok && weighingCalc.calc.finalAmountRial > 0n;
  } else {
    canGoNext = true;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="خرید طلای دست‌دوم">
        <UnitToggle />
      </PageHeader>
      <PurchaseStepper current={submission.receipt ? 'RECEIPT' : step} />

      <div className="flex-1 space-y-4 p-4 pb-32">
        {submission.receipt ? <PurchaseReceipt receipt={submission.receipt} /> : <>
        <fieldset disabled={locked} className="min-w-0 space-y-4">
        {step === 'SELLER' ? (
          <>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              طلای خریداری‌شده به‌طور پیش‌فرض به موجودی آبشده اضافه می‌شود.
            </p>
            <SellerDetailsStep seller={seller} onSellerChange={setSeller} />
          </>
        ) : null}

        {step === 'WEIGHING' ? (
          <SecondHandWeighingForm
            grossWeightMg={grossWeightBigInt}
            onGrossWeightChange={(v) => setGrossWeightMg(v.toString())}
            stoneWeightMg={stoneWeightBigInt}
            onStoneWeightChange={(v) => setStoneWeightMg(v.toString())}
            otherDeductionWeightMg={otherDeductionWeightBigInt}
            onOtherDeductionWeightChange={(v) => setOtherDeductionWeightMg(v.toString())}
            karat={BigInt(purchaseKarat)}
            onKaratChange={(v) => setPurchaseKarat(toSafeNumber(v))}
            feeRial={feeBigInt}
            onFeeChange={(v) => setFeeRial(v.toString())}
            maznehRial={maznehRial}
            mode="WEIGHING"
          />
        ) : null}

        {step === 'DEDUCTIONS' ? (
          <SecondHandWeighingForm
            grossWeightMg={grossWeightBigInt}
            onGrossWeightChange={(v) => setGrossWeightMg(v.toString())}
            stoneWeightMg={stoneWeightBigInt}
            onStoneWeightChange={(v) => setStoneWeightMg(v.toString())}
            otherDeductionWeightMg={otherDeductionWeightBigInt}
            onOtherDeductionWeightChange={(v) => setOtherDeductionWeightMg(v.toString())}
            karat={BigInt(purchaseKarat)}
            onKaratChange={(v) => setPurchaseKarat(toSafeNumber(v))}
            feeRial={feeBigInt}
            onFeeChange={(v) => setFeeRial(v.toString())}
            maznehRial={maznehRial}
            mode="DEDUCTIONS"
          />
        ) : null}

        {step === 'KARAT' ? (
          <SecondHandWeighingForm
            grossWeightMg={grossWeightBigInt}
            onGrossWeightChange={(v) => setGrossWeightMg(v.toString())}
            stoneWeightMg={stoneWeightBigInt}
            onStoneWeightChange={(v) => setStoneWeightMg(v.toString())}
            otherDeductionWeightMg={otherDeductionWeightBigInt}
            onOtherDeductionWeightChange={(v) => setOtherDeductionWeightMg(v.toString())}
            karat={BigInt(purchaseKarat)}
            onKaratChange={(v) => setPurchaseKarat(toSafeNumber(v))}
            feeRial={feeBigInt}
            onFeeChange={(v) => setFeeRial(v.toString())}
            maznehRial={maznehRial}
            mode="KARAT"
          />
        ) : null}

        {step === 'QUOTE' ? <MaznehBar isOnline={isOnline} /> : null}

        {step === 'AMOUNT' ? (
          <SecondHandWeighingForm
            grossWeightMg={grossWeightBigInt}
            onGrossWeightChange={(v) => setGrossWeightMg(v.toString())}
            stoneWeightMg={stoneWeightBigInt}
            onStoneWeightChange={(v) => setStoneWeightMg(v.toString())}
            otherDeductionWeightMg={otherDeductionWeightBigInt}
            onOtherDeductionWeightChange={(v) => setOtherDeductionWeightMg(v.toString())}
            karat={BigInt(purchaseKarat)}
            onKaratChange={(v) => setPurchaseKarat(toSafeNumber(v))}
            feeRial={feeBigInt}
            onFeeChange={(v) => setFeeRial(v.toString())}
            maznehRial={maznehRial}
            mode="AMOUNT"
          />
        ) : null}

        {step === 'PAYMENT' ? (
          <section className="space-y-4" aria-label="پرداخت خرید">
            <h2 className="text-base font-semibold">پرداخت به فروشنده</h2>
            {weighingCalc.ok ? <>
              <p>مبلغ نهایی: <AmountDisplay amount={weighingCalc.calc.dualFinalAmount} /></p>
              <MoneyInput label="پرداخت اکنون (ریال)" value={paid} onChange={(v) => setPaidRial(v.toString())} disabled={locked}
                hint="مبلغ پرداخت‌نشده به مانده بستانکاری فروشنده اضافه می‌شود." />
              <Button type="button" variant="outline" disabled={locked} onClick={() => setPaidRial(weighingCalc.calc.finalAmountRial.toString())}>پرداخت کامل</Button>
              {paid > weighingCalc.calc.finalAmountRial ? <p role="alert" className="text-sm text-destructive">پرداخت نمی‌تواند بیشتر از مبلغ خرید باشد.</p> :
                <p>مانده بستانکاری: <AmountDisplay amount={dualFromRial(weighingCalc.calc.finalAmountRial - paid, weighingCalc.calc.goldRatePerGramRial)} /></p>}
            </> : <p role="alert">{weighingCalc.error}</p>}
          </section>
        ) : null}
        </fieldset>
        {!isOnline ? <p role="alert">برای ثبت خرید به اینترنت متصل شوید.</p> : null}
        {submission.attempt && !submission.isSubmitting ? <p role="status">نتیجه درخواست قبلی هنوز مشخص نیست. برای دریافت نتیجه، همان خرید را دوباره بررسی کنید.</p> : null}
        {submission.error ? <ApiErrorNotice error={submission.error} /> : null}
        </>}
      </div>

      {/* اقدام اصلی پایین صفحه — منطقه‌ی شست، همیشه بدون اسکرول دیده می‌شود */}
      <div className="fixed inset-x-0 bottom-above-nav z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm lg:static lg:border-0 lg:bg-transparent">
        {submission.receipt ? <Button type="button" size="action" className="w-full" onClick={submission.startNew}>خرید جدید</Button> : <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="outline"
            size="action"
            disabled={isFirstStep || locked}
            onClick={back}
          >
            قبلی
          </Button>
          {isLastEntryStep ? (
            <Button type="button" size="action" disabled={!canSubmit} onClick={() => void submission.submit()} aria-busy={submission.isSubmitting}>
              {submission.isSubmitting ? 'در حال ثبت…' : submission.attempt ? 'بررسی نتیجه خرید' : 'ثبت خرید'}
            </Button>
          ) : (
            <Button type="button" size="action" disabled={!canGoNext || locked} onClick={next}>
              بعدی
            </Button>
          )}
        </div>}
      </div>

      {/* صفحه‌کلید عددی سفارشی درون‌برنامه‌ای */}
      <NumericKeypad />
    </div>
  );
}
