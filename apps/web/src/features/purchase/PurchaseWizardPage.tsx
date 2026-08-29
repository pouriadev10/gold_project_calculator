import { useBlocker } from '@tanstack/react-router';
import { AlertTriangle, Construction, Info } from 'lucide-react';
import { PartySelector } from '@/components/common/PartySelector';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { useMazneh } from '@/features/home/useMazneh';
import { MaznehBar } from '@/features/home/MaznehBar';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import {
  hasPurchaseDraftProgress,
  NAVIGABLE_PURCHASE_STEPS,
  PURCHASE_STEPS,
  usePurchaseDraftStore,
  type PurchaseStep,
} from '@/stores/purchase-draft-store';
import { PurchaseStepper } from './PurchaseStepper';

/**
 * صفحه‌ی خرید طلای دست‌دوم — shell جریان هشت‌مرحله‌ای (FE-056).
 *
 * **مستقل از ویزارد فروش** — قاعده‌ی صریح تسک. هیچ کامپوننت یا storeای از
 * `features/sales` اینجا نیست؛ فقط زیرساخت مشترک (`PartySelector` در
 * `components/common/` که مستنداتش از روز اول «فروشنده» را هم مثال
 * می‌زد، و `MaznehBar`) و store پیش‌نویس مخصوص همین جریان
 * (`purchase-draft-store.ts`).
 *
 * دو مرحله محتوای واقعی دارند:
 * - **فروشنده**: مستقیم `PartySelector` (FE-035) — بدون انتخاب، «بعدی»
 *   غیرفعال است. خرید دست‌دوم فقط از **مصرف‌کننده** ممکن است (سرور:
 *   `SecondHandPurchasePartyNotConsumerError`؛ همکار یعنی مرجوعی B2B که
 *   خارج از دامنه‌ی فاز ۱ است) — انتخاب همکار «بعدی» را قفل می‌کند.
 * - **مظنه**: مستقیم `MaznehBar` (FE-029) — خرید هم `quoteId` می‌خواهد
 *   (`createSecondHandGoldPurchaseSchema`)، پس بدون مظنه «بعدی» غیرفعال است.
 *
 * **وزن‌کشی، کسورات، عیار، مبلغ، پرداخت** جانگه‌دارند — فرم وزن‌کشی با همه‌ی
 * این فیلدها کار FE-057 است و ثبت/پرداخت/رسید کار FE-059؛ طراحی زودهنگام
 * شکلشان بدون داده، همان چیزی است که store پیش‌نویس هم از آن پرهیز می‌کند.
 * دو قاعده‌ی تسک از همین حالا تضمین شده‌اند، نه به بعد موکول:
 * - **مقصد پیش‌فرض آبشده** روی مرحله‌ی اول نمایش داده می‌شود — سرور همیشه
 *   `MELTED_GOLD` می‌سازد و ورودی مقصد در قرارداد وجود ندارد.
 * - **هیچ عددی از عیار پیش‌فرض در UI نیست** — قرارداد `purchaseKarat` را
 *   اختیاری می‌گیرد و نبودش یعنی پیش‌فرض نسخه‌دار مستأجر را خود سرور
 *   اعمال کند؛ «۷۴۰» در هیچ‌جای این جریان نوشته نمی‌شود.
 *
 * کلید تعویض واحد و کیپد عددی فعلاً mount نمی‌شوند — هیچ عدد مالی یا
 * فیلد عددی در این صفحه هنوز رندر نمی‌شود؛ FE-057 هنگام افزودن پیش‌نمایش
 * مبلغ `UnitToggle` و هنگام افزودن فیلدهای وزنی دقیقاً یک `<NumericKeypad />`
 * اضافه می‌کند (قاعده‌ی مستندشده در `SaleWizardPage`).
 *
 * `useBlocker` هشدار خروج مسیر برای پیش‌نویس نیمه‌کاره است — همان نقشش در
 * فروش؛ پایداری draft در برابر refresh را خودِ store با `sessionStorage`
 * می‌دهد. پس از ثبت موفق (FE-059) رسید جای مراحل می‌نشیند — «رسید» در
 * `PURCHASE_STEPS` مقصد جریان است، نه مرحله‌ی پیمایش‌پذیر با «بعدی».
 */

const STEP_PLACEHOLDER: Record<
  Extract<PurchaseStep, 'WEIGHING' | 'DEDUCTIONS' | 'KARAT' | 'AMOUNT' | 'PAYMENT'>,
  string
> = {
  WEIGHING: 'فرم وزن‌کشی خرید در تسک بعد اضافه می‌شود.',
  DEDUCTIONS: 'ثبت وزن نگین و سایر کسورات کنار وزن‌کشی اضافه می‌شود.',
  KARAT: 'انتخاب عیار خرید — با پیش‌فرضِ نسخه‌دار مستأجر از سرور — در تسک وزن‌کشی اضافه می‌شود.',
  AMOUNT: 'پیش‌نمایش مبلغ خرید (نرخ گرم عیار خرید، کارمزد، مبلغ نهایی) در تسک وزن‌کشی اضافه می‌شود.',
  PAYMENT: 'ثبت پرداخت و ثبت نهایی خرید در تسک بعد اضافه می‌شود.',
};

export default function PurchaseWizardPage() {
  const isOnline = useOnlineStatus();
  const mazneh = useMazneh();
  const step = usePurchaseDraftStore((s) => s.step);
  const seller = usePurchaseDraftStore((s) => s.seller);
  const next = usePurchaseDraftStore((s) => s.next);
  const back = usePurchaseDraftStore((s) => s.back);
  const setSeller = usePurchaseDraftStore((s) => s.setSeller);

  useBlocker(() => true, hasPurchaseDraftProgress({ step, seller }));

  const stepIndex = PURCHASE_STEPS.indexOf(step);
  const isFirstStep = stepIndex === 0;
  const isLastEntryStep = step === NAVIGABLE_PURCHASE_STEPS[NAVIGABLE_PURCHASE_STEPS.length - 1];
  // خرید دست‌دوم فقط از مصرف‌کننده — همان خطای واقعی سرور، اینجا زودتر نشان داده می‌شود
  const isNonConsumerSeller = seller !== null && seller.type !== 'CONSUMER';

  const canGoNext =
    step === 'SELLER'
      ? seller !== null && !isNonConsumerSeller
      : step === 'QUOTE'
        ? Boolean(mazneh.data)
        : true;

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="خرید طلای دست‌دوم" />
      <PurchaseStepper current={step} />

      <div className="flex-1 space-y-4 p-4 pb-32">
        {step === 'SELLER' ? (
          <>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              طلای خریداری‌شده به‌طور پیش‌فرض به موجودی آبشده اضافه می‌شود.
            </p>
            <PartySelector label="فروشنده" value={seller} onChange={setSeller} />
            {isNonConsumerSeller ? (
              <p className="flex items-start gap-1.5 text-xs text-warning" role="alert">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                خرید دست‌دوم فقط از شخص مصرف‌کننده ثبت می‌شود؛ همکار انتخاب شده است.
              </p>
            ) : null}
          </>
        ) : null}
        {step === 'QUOTE' ? <MaznehBar isOnline={isOnline} /> : null}
        {step === 'WEIGHING' ? (
          <EmptyState icon={Construction} title="این بخش هنوز ساخته نشده است" description={STEP_PLACEHOLDER.WEIGHING} />
        ) : null}
        {step === 'DEDUCTIONS' ? (
          <EmptyState icon={Construction} title="این بخش هنوز ساخته نشده است" description={STEP_PLACEHOLDER.DEDUCTIONS} />
        ) : null}
        {step === 'KARAT' ? (
          <EmptyState icon={Construction} title="این بخش هنوز ساخته نشده است" description={STEP_PLACEHOLDER.KARAT} />
        ) : null}
        {step === 'AMOUNT' ? (
          <EmptyState icon={Construction} title="این بخش هنوز ساخته نشده است" description={STEP_PLACEHOLDER.AMOUNT} />
        ) : null}
        {step === 'PAYMENT' ? (
          <EmptyState icon={Construction} title="این بخش هنوز ساخته نشده است" description={STEP_PLACEHOLDER.PAYMENT} />
        ) : null}
      </div>

      {/* اقدام اصلی پایین صفحه — منطقه‌ی شست، همیشه بدون اسکرول دیده می‌شود */}
      <div className="fixed inset-x-0 bottom-above-nav z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm lg:static lg:border-0 lg:bg-transparent">
        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="outline"
            size="action"
            disabled={isFirstStep}
            onClick={back}
          >
            قبلی
          </Button>
          {isLastEntryStep ? (
            /*
              دکمه‌ی ثبت روی مرحله‌ی آخر از همین حالا می‌نشیند ولی تا FE-059
              (submit با idempotency) هیچ مسیری را صدا نمی‌زند — disabled صریح،
              نه پنهان، تا جای اقدام نهایی از قبل جا افتاده باشد.
            */
            <Button type="button" size="action" disabled>
              ثبت خرید
            </Button>
          ) : (
            <Button type="button" size="action" disabled={!canGoNext} onClick={next}>
              بعدی
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
