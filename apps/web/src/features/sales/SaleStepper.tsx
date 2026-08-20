import { Check } from 'lucide-react';
import { toPersianDigits } from '@gold/core-calc';
import { cn } from '@/lib/utils';
import { SALE_STEPS, type SaleStep } from '@/stores/sale-draft-store';

/**
 * نشانگر پیشرفت مراحل فروش — قاعده‌ی «پیشرفت مراحل واضح» (FE-041).
 *
 * فقط دایره‌های شماره‌دار + خط اتصال؛ برچسب کامل هر پنج مرحله زیر
 * ۳۶۰px جا نمی‌شود (بخش ۶ CLAUDE.md، شروع از ۳۶۰px). عنوان مرحله‌ی
 * جاری جدا، زیر دایره‌ها، به‌صورت متن کامل نمایش داده می‌شود.
 */

const STEP_LABEL: Record<SaleStep, string> = {
  QUOTE: 'مظنه',
  PARTY: 'مشتری',
  ITEMS: 'اقلام',
  PAYMENT: 'پرداخت',
  REVIEW: 'مرور و ثبت',
};

export function SaleStepper({ current }: { current: SaleStep }) {
  const currentIndex = SALE_STEPS.indexOf(current);

  return (
    <div className="px-4 py-3">
      <ol className="flex items-center" aria-label="مراحل فروش">
        {SALE_STEPS.map((step, index) => {
          const isDone = index < currentIndex;
          const isCurrent = step === current;
          return (
            <li key={step} className={cn('flex items-center', index < SALE_STEPS.length - 1 && 'flex-1')}>
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
              {index < SALE_STEPS.length - 1 ? (
                <span className={cn('mx-1 h-0.5 flex-1', isDone ? 'bg-primary' : 'bg-muted')} aria-hidden="true" />
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-sm font-medium">
        مرحله {toPersianDigits(String(currentIndex + 1))} از {toPersianDigits(String(SALE_STEPS.length))} —{' '}
        {STEP_LABEL[current]}
      </p>
    </div>
  );
}
