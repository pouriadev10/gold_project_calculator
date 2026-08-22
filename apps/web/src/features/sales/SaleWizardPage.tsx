import { useBlocker } from '@tanstack/react-router';
import { AlertTriangle, Construction, Loader2 } from 'lucide-react';
import { PartySelector } from '@/components/common/PartySelector';
import { ApiErrorNotice } from '@/components/common/ApiErrorNotice';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { UnitToggle } from '@/components/common/UnitToggle';
import { Button } from '@/components/ui/button';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { useMazneh } from '@/features/home/useMazneh';
import { MaznehBar } from '@/features/home/MaznehBar';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { hasSaleDraftProgress, SALE_STEPS, useSaleDraftStore, type SaleStep } from '@/stores/sale-draft-store';
import { JewelryItemSelector } from './JewelryItemSelector';
import { SaleStepper } from './SaleStepper';
import { SaleSubmitResult } from './SaleSubmitResult';
import { SaleSummary } from './SaleSummary';
import { useJewelryCashSaleSubmit } from './useJewelryCashSaleSubmit';

/**
 * صفحه‌ی شروع فروش — shell جریان فروش سریع (FE-041).
 *
 * سه مرحله‌ی اول محتوای واقعی دارند:
 * - **مظنه**: مستقیم `MaznehBar` (FE-029) — بدون مظنه، «بعدی» غیرفعال
 *   است، چون فروش بدون نرخ قیمت‌گذاری‌پذیر نیست.
 * - **مشتری**: مستقیم `PartySelector` (FE-035) — بدون انتخاب، «بعدی»
 *   غیرفعال است، چون هر فروشی به یک طرف حساب نیاز دارد.
 * - **اقلام**: `JewelryItemSelector` (FE-042) — بدون حداقل یک قلم،
 *   «بعدی» غیرفعال است؛ فروش بدون کالا معنا ندارد.
 *
 * مرور با `SaleSummary` (FE-044) کار واقعی دارد — خلاصه‌ی فاکتور، شامل
 * مظنه‌ی قفل‌شده — و از FE-045 دکمه‌ی پایین همان مرحله واقعاً ثبت می‌کند
 * (`useJewelryCashSaleSubmit`). پرداخت هنوز جانگه‌دار است — کار FE-050؛
 * «بعدی» رویش همیشه فعال است چون چیزی برای اعتبارسنجی‌اش هنوز وجود ندارد.
 *
 * **حین ثبت، صفحه قفل می‌شود** (`isSubmitting`): «قبلی» و «ثبت» هر دو
 * غیرفعال‌اند — قاعده‌ی صریح FE-045 «جلوگیری از تغییر فرم حین submit».
 * اگر کاربر بتواند وسط درخواست به مرحله‌ی اقلام برگردد و قلمی عوض کند،
 * payloadی که در راه است دیگر با چیزی که روی صفحه می‌بیند نمی‌خواند.
 *
 * **پس از موفقیت**، به‌جای مراحل، نتیجه‌ی سرور (`SaleSubmitResult`) نشان
 * داده می‌شود و تنها اقدام صفحه «فروش جدید» است. پیش‌نویس همان لحظه پاک
 * شده، ولی نتیجه در state هوک زنده مانده — رسید با پاک‌شدن پیش‌نویس گم
 * نمی‌شود.
 *
 * دقیقاً یک `<NumericKeypad />` اینجا mount می‌شود — قاعده‌ی مستندشده در
 * `JewelryItemFormDialog.tsx` (FE-036): هر صفحه‌ای که فیلد کیپدی
 * (اینجا `WeightInput`/`KaratInput` داخل `JewelryItemSelector`) دارد
 * باید دقیقاً یک نمونه در درخت خودش داشته باشد، نه صفر و نه بیشتر از یک.
 *
 * `useBlocker` هم‌زمان دو قاعده را برآورده می‌کند: «route leave warning»
 * (پیمایش داخلی مسدود و با تأیید مرورگر پرسیده می‌شود) و نیمی از
 * «refresh رفتار مشخص داشته باشد» (`enableBeforeUnload` هشدار مرورگر
 * پیش از تازه‌سازی/بستن را هم فعال می‌کند) — نیم دیگرش را خودِ
 * `sale-draft-store.ts` با `sessionStorage` می‌دهد: حتی اگر کاربر از آن
 * هشدار رد شود، draft از دست نمی‌رود.
 */

const STEP_PLACEHOLDER: Record<Extract<SaleStep, 'PAYMENT'>, string> = {
  PAYMENT: 'ثبت روش پرداخت در تسک بعد اضافه می‌شود.',
};

export default function SaleWizardPage() {
  const isOnline = useOnlineStatus();
  const mazneh = useMazneh();
  const step = useSaleDraftStore((s) => s.step);
  const party = useSaleDraftStore((s) => s.party);
  const items = useSaleDraftStore((s) => s.items);
  const next = useSaleDraftStore((s) => s.next);
  const back = useSaleDraftStore((s) => s.back);
  const setParty = useSaleDraftStore((s) => s.setParty);
  const setItems = useSaleDraftStore((s) => s.setItems);

  const { preparation, isSubmitting, error, outcome, submit, startNewSale } = useJewelryCashSaleSubmit();

  /*
   * حین ارسال هم مسدود می‌ماند حتی اگر پیش‌نویس «پیشرفت» نداشته باشد —
   * ترک صفحه وسط یک نوشتن مالی بدترین لحظه‌ی ممکن است. بعد از موفقیت
   * برعکس: پیش‌نویس پاک شده و رسید هیچ چیز از‌دست‌رفتنی ندارد.
   */
  useBlocker(() => true, isSubmitting || (outcome === null && hasSaleDraftProgress({ step, party, items })));

  const stepIndex = SALE_STEPS.indexOf(step);
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === SALE_STEPS.length - 1;
  const canGoNext =
    step === 'QUOTE'
      ? Boolean(mazneh.data)
      : step === 'PARTY'
        ? party !== null
        : step === 'ITEMS'
          ? items.length > 0
          : true;

  if (outcome !== null) {
    return (
      <div className="flex min-h-dvh flex-col">
        <PageHeader title="فروش ثبت شد">
          <UnitToggle />
        </PageHeader>

        <div className="flex-1 space-y-4 p-4 pb-32">
          <SaleSubmitResult outcome={outcome} />
        </div>

        <div className="fixed inset-x-0 bottom-above-nav z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm lg:static lg:border-0 lg:bg-transparent">
          <Button type="button" size="action" className="w-full" onClick={startNewSale}>
            فروش جدید
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="فروش جدید">{step === 'REVIEW' ? <UnitToggle /> : null}</PageHeader>
      <SaleStepper current={step} />

      <div className="flex-1 space-y-4 p-4 pb-32">
        {step === 'QUOTE' ? <MaznehBar isOnline={isOnline} /> : null}
        {step === 'PARTY' ? <PartySelector label="مشتری" value={party} onChange={setParty} /> : null}
        {step === 'ITEMS' ? <JewelryItemSelector items={items} onChange={setItems} /> : null}
        {step === 'PAYMENT' ? (
          <EmptyState icon={Construction} title="این بخش هنوز ساخته نشده است" description={STEP_PLACEHOLDER.PAYMENT} />
        ) : null}
        {step === 'REVIEW' ? (
          <>
            <SaleSummary />
            {/*
              خطای ثبت در بدنه‌ی صفحه می‌ماند، نه در toast: عملیات مالی
              شکست‌خورده نباید بعد از چند ثانیه ناپدید شود. پیش‌نویس هم
              دست‌نخورده است، پس کاربر می‌تواند برگردد، اصلاح کند و دوباره بزند.
            */}
            {error ? <ApiErrorNotice error={error} /> : null}
            {!preparation.ok ? (
              <p className="flex items-start gap-1.5 text-xs text-warning" role="alert">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {preparation.message}
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      {/* اقدام اصلی پایین صفحه — منطقه‌ی شست، همیشه بدون اسکرول دیده می‌شود */}
      <div className="fixed inset-x-0 bottom-above-nav z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm lg:static lg:border-0 lg:bg-transparent">
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="outline"
            size="action"
            disabled={isFirstStep || isSubmitting}
            onClick={back}
          >
            قبلی
          </Button>
          {isLastStep ? (
            <Button
              type="button"
              size="action"
              disabled={!preparation.ok || isSubmitting}
              onClick={() => void submit()}
            >
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {isSubmitting ? 'در حال ثبت...' : 'ثبت فروش'}
            </Button>
          ) : (
            <Button type="button" size="action" disabled={!canGoNext} onClick={next}>
              بعدی
            </Button>
          )}
        </div>
      </div>

      <NumericKeypad />
    </div>
  );
}
