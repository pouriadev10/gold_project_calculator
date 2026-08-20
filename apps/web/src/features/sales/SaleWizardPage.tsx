import { useBlocker } from '@tanstack/react-router';
import { Construction } from 'lucide-react';
import { PartySelector } from '@/components/common/PartySelector';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { useMazneh } from '@/features/home/useMazneh';
import { MaznehBar } from '@/features/home/MaznehBar';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { hasSaleDraftProgress, SALE_STEPS, useSaleDraftStore, type SaleStep } from '@/stores/sale-draft-store';
import { SaleStepper } from './SaleStepper';

/**
 * صفحه‌ی شروع فروش — shell جریان فروش سریع (FE-041).
 *
 * فقط دو مرحله‌ی اول محتوای واقعی دارند:
 * - **مظنه**: مستقیم `MaznehBar` (FE-029) — بدون مظنه، «بعدی» غیرفعال
 *   است، چون فروش بدون نرخ قیمت‌گذاری‌پذیر نیست.
 * - **مشتری**: مستقیم `PartySelector` (FE-035) — بدون انتخاب، «بعدی»
 *   غیرفعال است، چون هر فروشی به یک طرف حساب نیاز دارد.
 *
 * اقلام/پرداخت/مرور جانگه‌دارند — کار FE-042 تا FE-045. این‌جا فقط
 * *مسیر عبور* از آن‌ها ساخته می‌شود، نه محتوایشان؛ «بعدی» رویشان همیشه
 * فعال است چون چیزی برای اعتبارسنجی هنوز وجود ندارد.
 *
 * `useBlocker` هم‌زمان دو قاعده را برآورده می‌کند: «route leave warning»
 * (پیمایش داخلی مسدود و با تأیید مرورگر پرسیده می‌شود) و نیمی از
 * «refresh رفتار مشخص داشته باشد» (`enableBeforeUnload` هشدار مرورگر
 * پیش از تازه‌سازی/بستن را هم فعال می‌کند) — نیم دیگرش را خودِ
 * `sale-draft-store.ts` با `sessionStorage` می‌دهد: حتی اگر کاربر از آن
 * هشدار رد شود، draft از دست نمی‌رود.
 */

const STEP_PLACEHOLDER: Record<Extract<SaleStep, 'ITEMS' | 'PAYMENT' | 'REVIEW'>, string> = {
  ITEMS: 'انتخاب و ویرایش اقلام فروش در تسک بعد اضافه می‌شود.',
  PAYMENT: 'ثبت روش پرداخت در تسک بعد اضافه می‌شود.',
  REVIEW: 'مرور نهایی و ثبت فاکتور در تسک بعد اضافه می‌شود.',
};

export default function SaleWizardPage() {
  const isOnline = useOnlineStatus();
  const mazneh = useMazneh();
  const step = useSaleDraftStore((s) => s.step);
  const party = useSaleDraftStore((s) => s.party);
  const next = useSaleDraftStore((s) => s.next);
  const back = useSaleDraftStore((s) => s.back);
  const setParty = useSaleDraftStore((s) => s.setParty);

  useBlocker(() => true, hasSaleDraftProgress({ step, party }));

  const stepIndex = SALE_STEPS.indexOf(step);
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === SALE_STEPS.length - 1;
  const canGoNext = step === 'QUOTE' ? Boolean(mazneh.data) : step === 'PARTY' ? party !== null : true;

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="فروش جدید" />
      <SaleStepper current={step} />

      <div className="flex-1 space-y-4 p-4 pb-32">
        {step === 'QUOTE' ? <MaznehBar isOnline={isOnline} /> : null}
        {step === 'PARTY' ? <PartySelector label="مشتری" value={party} onChange={setParty} /> : null}
        {step === 'ITEMS' || step === 'PAYMENT' || step === 'REVIEW' ? (
          <EmptyState icon={Construction} title="این بخش هنوز ساخته نشده است" description={STEP_PLACEHOLDER[step]} />
        ) : null}
      </div>

      {/* اقدام اصلی پایین صفحه — منطقه‌ی شست، همیشه بدون اسکرول دیده می‌شود */}
      <div className="fixed inset-x-0 bottom-above-nav z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm lg:static lg:border-0 lg:bg-transparent">
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="outline" size="action" disabled={isFirstStep} onClick={back}>
            قبلی
          </Button>
          {isLastStep ? (
            <Button type="button" size="action" disabled title="ثبت فروش در تسک بعد اضافه می‌شود">
              ثبت فروش (به‌زودی)
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
