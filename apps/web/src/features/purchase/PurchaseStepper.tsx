import { Check } from 'lucide-react';
import { toPersianDigits } from '@gold/core-calc';
import { cn } from '@/lib/utils';
import { PURCHASE_STEPS, type PurchaseStep } from '@/stores/purchase-draft-store';

/**
 * نشانگر پیشرفت مراحل خرید دست‌دوم — قاعده‌ی «پیشرفت مراحل واضح» (FE-056).
 *
 * ساختار عیناً الگوی `SaleStepper` است ولی **کد مشترک نشد** — قاعده‌ی
 * صریح تسک: «UI مستقل از فروش باشد»؛ و مرز Featureها (FE-004) هم import
 * داخلی بین features را ممنوع می‌کند. هشت مرحله‌ی خرید (شامل «رسید») در
 * ۳۶۰px فقط با دایره‌های شماره‌دار جا می‌شود؛ برچسب کامل مرحله‌ی جاری
 * جدا زیر دایره‌ها می‌آید.
 *
 * «رسید» در فهرست هست ولی با «بعدی» وارد نمی‌شود — حالت پس از ثبت موفق
 * است (FE-059)؛ اینجا فقط مقصد جریان را نشان می‌دهد.
 */

const STEP_LABEL: Record<PurchaseStep, string> = {
  SELLER: 'فروشنده',
  WEIGHING: 'وزن‌کشی',
  DEDUCTIONS: 'کسورات',
  KARAT: 'عیار',
  QUOTE: 'مظنه',
  AMOUNT: 'مبلغ',
  PAYMENT: 'پرداخت',
  RECEIPT: 'رسید',
};

export function PurchaseStepper({ current }: { current: PurchaseStep }) {
  const currentIndex = PURCHASE_STEPS.indexOf(current);

  return (
    <div className="px-4 py-3">
      <ol className="flex items-center" aria-label="مراحل خرید">
        {PURCHASE_STEPS.map((step, index) => {
          const isDone = index < currentIndex;
          const isCurrent = step === current;
          return (
            <li key={step} className={cn('flex items-center', index < PURCHASE_STEPS.length - 1 && 'flex-1')}>
              <span
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums transition-colors',
                  isDone && 'bg-primary text-primary-foreground',
                  isCurrent && 'bg-primary/15 text-primary ring-2 ring-primary',
                  !isDone && !isCurrent && 'bg-muted text-muted-foreground',
                )}
              >
                {isDone ? <Check className="size-4" aria-hidden="true" /> : index + 1}
              </span>
              {index < PURCHASE_STEPS.length - 1 ? (
                <span className={cn('mx-0.5 h-0.5 flex-1', isDone ? 'bg-primary' : 'bg-muted')} aria-hidden="true" />
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-sm font-medium">
        مرحله {toPersianDigits(String(currentIndex + 1))} از {toPersianDigits(String(PURCHASE_STEPS.length))} —{' '}
        {STEP_LABEL[current]}
      </p>
    </div>
  );
}
