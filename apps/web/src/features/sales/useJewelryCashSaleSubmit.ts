import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatRial } from '@gold/core-calc';
import type { CreateJewelryCashSaleInput, JewelryCashSale } from '@/api/contracts';
import { createJewelryCashSale } from '@/api/sales';
import { queryKeys } from '@/api/query-keys';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import { toast } from '@/stores/toast-store';
import { useSaleDraftStore, type LockedMazneh } from '@/stores/sale-draft-store';
import type { PartySelection } from '@/stores/recent-parties-store';
import { prepareJewelryCashSale, type SaleSubmitPreparation } from './sale-submit';

/**
 * ثبت فروش نقدی زیورآلات — FE-045.
 *
 * منطق ثبت عمداً از `SaleWizardPage` بیرون کشیده شده: دکمه‌ی ثبت در نوار
 * ثابت پایین صفحه است (منطقه‌ی شست، بخش ۶ CLAUDE.md) ولی نتیجه و خطا در
 * بدنه‌ی صفحه رندر می‌شوند — دو نقطه‌ی رندر دور از هم که باید یک state
 * مشترک ببینند.
 *
 * **چرا `useIdempotentSubmit` و نه `useMutation`:** کلید Idempotency باید
 * در طول تلاش‌های مجدد همان بماند. `useMutation` هر بار `mutationFn` را با
 * همان آرگومان‌ها صدا می‌زند و کلید تازه‌ی داخل `apiPost` یعنی فاکتور دوم.
 * اینجا کلید تا `reset()` صریح (فقط بعد از موفقیت قطعی) ثابت است — پس
 * «ارسال تکراری یک فاکتور نسازد» حتی وقتی پاسخ اول در راه گم شود هم
 * برقرار می‌ماند، نه فقط وقتی کاربر دوبار سریع بزند (آن را قفل سنکرون
 * `useIdempotentSubmit` جدا می‌گیرد).
 *
 * **پیش‌نویس روی خطا دست‌نخورده می‌ماند** — «خطای میانی draft را قابل
 * اصلاح نگه دارد». فقط بعد از پاسخ موفق سرور `reset()` صدا زده می‌شود، و
 * حتی آن‌وقت هم نتیجه در state محلی این هوک زنده می‌ماند تا رسید نمایش
 * داده شود؛ پیش‌نویس پاک می‌شود ولی رسید نه.
 */

export interface SaleSubmitOutcome {
  /** پاسخ سرور — تنها منبع شماره‌ی فاکتور و مبلغ ثبت‌شده. */
  readonly sale: JewelryCashSale;
  /** مشتری همان فروش، از پیش‌نویسِ لحظه‌ی ثبت — پاسخ سرور نامی برنمی‌گرداند. */
  readonly party: PartySelection;
  /**
   * نرخ قفل‌شده‌ی همان فاکتور — اینجا کپی می‌شود چون پیش‌نویس بلافاصله
   * پس از موفقیت پاک می‌شود و رسید بعد از آن رندر می‌گردد.
   */
  readonly lockedMazneh: LockedMazneh;
  /**
   * اختلاف پیش‌نمایش کلاینت با مبلغ سرور، اگر اختلافی بود. عدد سرور
   * همیشه درست است؛ این فقط برای دیده‌شدن اختلاف است، نه اصلاح آن.
   */
  readonly previewMismatchRial: bigint | undefined;
}

export interface JewelryCashSaleSubmit {
  /** آماده‌بودن ثبت، یا دلیل مسدودبودنش — برای `disabled` دکمه و پیام کنارش. */
  readonly preparation: SaleSubmitPreparation;
  readonly isSubmitting: boolean;
  readonly error: unknown;
  readonly outcome: SaleSubmitOutcome | null;
  readonly submit: () => Promise<void>;
  /** بستن رسید و شروع فروش بعدی. */
  readonly startNewSale: () => void;
}

export function useJewelryCashSaleSubmit(): JewelryCashSaleSubmit {
  const party = useSaleDraftStore((s) => s.party);
  const items = useSaleDraftStore((s) => s.items);
  const lockedMazneh = useSaleDraftStore((s) => s.lockedMazneh);
  const resetDraft = useSaleDraftStore((s) => s.reset);
  const queryClient = useQueryClient();

  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<SaleSubmitOutcome | null>(null);

  const {
    submit: runSubmit,
    isSubmitting,
    reset: resetKey,
  } = useIdempotentSubmit((key: string, payload: CreateJewelryCashSaleInput) =>
    createJewelryCashSale(payload, key),
  );

  /*
   * `effectiveAt` لحظه‌ی هر رندر است، نه لحظه‌ی ضربه — ولی فقط برای
   * سنجش «آیا ثبت مجاز است؟» استفاده می‌شود؛ payloadی که واقعاً ارسال
   * می‌شود در خودِ `submit` دوباره و با زمان همان لحظه ساخته می‌شود.
   */
  const preparation = prepareJewelryCashSale({ party, items, lockedMazneh }, new Date());

  const submit = useCallback(async () => {
    const prepared = prepareJewelryCashSale({ party, items, lockedMazneh }, new Date());
    // `party === null` از قبل `prepared.ok` را false کرده؛ تکرارش فقط برای narrowing تایپ است
    if (!prepared.ok || party === null || lockedMazneh === null) return;

    setError(null);
    try {
      const sale = await runSubmit(prepared.plan.payload);
      if (!sale) return; // ضربه‌ی دوم حین ارسال قبلی — بی‌اثر، نه خطا

      const preview = prepared.plan.previewPayableRial;
      setOutcome({
        sale,
        party,
        lockedMazneh,
        previewMismatchRial:
          preview !== undefined && preview !== sale.payableRial ? sale.payableRial - preview : undefined,
      });

      /*
       * فروش هم‌زمان موجودی، مانده‌ی طرف حساب و اعداد داشبورد را جابه‌جا
       * می‌کند — هر سه باید تازه شوند، وگرنه کاربر بعد از ثبت، عدد قدیمی
       * را در صفحه‌ی دیگری می‌بیند و به داده شک می‌کند.
       */
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.inventoryBalances.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.jewelryItems.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.parties.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventoryMovements.all() }),
      ]);

      toast.success('فروش ثبت شد', `${formatRial(sale.payableRial)} ریال`);
      // موفقیت قطعی — کلید تازه برای فروش بعدی، و پیش‌نویس خالی
      resetKey();
      resetDraft();
    } catch (caught) {
      // پیش‌نویس دست‌نخورده می‌ماند تا کاربر بتواند اصلاح کند و دوباره بزند
      setError(caught);
    }
  }, [party, items, lockedMazneh, runSubmit, queryClient, resetKey, resetDraft]);

  const startNewSale = useCallback(() => {
    setOutcome(null);
    setError(null);
    resetDraft();
  }, [resetDraft]);

  return { preparation, isSubmitting, error, outcome, submit, startNewSale };
}
