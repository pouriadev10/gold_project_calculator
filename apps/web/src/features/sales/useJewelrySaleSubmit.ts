import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { formatRial } from '@gold/core-calc';
import {
  createJewelryCashSaleSchema,
  createJewelryCreditSaleSchema,
  type JewelryCashSale,
  type JewelryCreditSale,
} from '@/api/contracts';
import { createJewelryCashSale, createJewelryCreditSale } from '@/api/sales';
import { queryKeys } from '@/api/query-keys';
import { useFinancialSubmit } from '@/hooks/useFinancialSubmit';
import { toast } from '@/stores/toast-store';
import { useSaleDraftStore, type LockedMazneh } from '@/stores/sale-draft-store';
import type { PartySelection } from '@/stores/recent-parties-store';
import { prepareJewelrySale, type SaleSubmitPayload, type SaleSubmitPreparation } from './sale-submit';

/**
 * ثبت فروش زیورآلات — FE-045 (نقدی) و FE-047 (نسیه).
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
 * **یک کلید برای هر دو مسیر.** نقدی و نسیه دو endpoint جدا دارند، ولی
 * کلید همان یکی است: اگر کاربر بعد از یک خطا مبلغ پرداختی را عوض کند و
 * دوباره بزند، تلاش دوم **همان عملیات** است، نه یک فروش تازه — و سرور با
 * دیدن همان کلید نمی‌گذارد فاکتور دوم ساخته شود.
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
  /** نقدی یا نسیه — رسید بر اساس همین تصمیم می‌گیرد مانده را چطور نشان دهد. */
  readonly mode: SaleSubmitPayload['mode'];
  /**
   * مبلغ پرداخت‌شده و مانده‌ی فاکتور. برای نقدی هر دو از `payableRial`
   * سرور نتیجه می‌شوند (پرداخت کامل، مانده صفر — از **نوع فروش**، نه از
   * حساب کردن)؛ برای نسیه `receivableRial` مستقیم از پاسخ سرور می‌آید،
   * نه از تفریق `payable − paid` سمت کلاینت.
   */
  readonly paidRial: bigint;
  readonly receivableRial: bigint;
}

export interface JewelrySaleSubmit {
  /** آماده‌بودن ثبت، یا دلیل مسدودبودنش — برای `disabled` دکمه و پیام کنارش. */
  readonly preparation: SaleSubmitPreparation;
  readonly isSubmitting: boolean;
  /**
   * FE-100: تلاشی روی سیم رفته و پاسخ قطعی‌اش نیامده — جادوگر باید قفل باشد (نه «قبلی»، نه
   * ویرایش پرداخت)، چون «ثبت» فقط همان درخواست سنجاق‌شده را تکرار می‌کند.
   */
  readonly locked: boolean;
  /** پاسخ تلاش قبلی نامشخص است — دکمه «بررسی نتیجه» می‌شود. */
  readonly uncertain: boolean;
  /** FE-090: مرورگر آفلاین است — دکمه‌ی ثبت غیرفعال می‌شود (ثبت آفلاین وجود ندارد). */
  readonly offline: boolean;
  readonly error: unknown;
  readonly outcome: SaleSubmitOutcome | null;
  readonly submit: () => Promise<void>;
  /** بستن رسید و شروع فروش بعدی. */
  readonly startNewSale: () => void;
}

/** بدنه‌ی سنجاق‌شده‌ای که از sessionStorage برمی‌گردد دوباره با همان قرارداد سنجیده می‌شود. */
const saleSubmitPayloadSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('CASH'), input: createJewelryCashSaleSchema }),
  z.object({ mode: z.literal('CREDIT'), input: createJewelryCreditSaleSchema }),
]);

function post(key: string, payload: SaleSubmitPayload): Promise<JewelryCashSale | JewelryCreditSale> {
  return payload.mode === 'CASH'
    ? createJewelryCashSale(payload.input, key)
    : createJewelryCreditSale(payload.input, key);
}

export function useJewelrySaleSubmit(): JewelrySaleSubmit {
  const party = useSaleDraftStore((s) => s.party);
  const items = useSaleDraftStore((s) => s.items);
  const lockedMazneh = useSaleDraftStore((s) => s.lockedMazneh);
  const paidRial = useSaleDraftStore((s) => s.paidRial);
  const resetDraft = useSaleDraftStore((s) => s.reset);
  const queryClient = useQueryClient();

  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<SaleSubmitOutcome | null>(null);

  /*
   * لحظه‌ی فروش هم‌عمر کلید Idempotency است (FE-094). سرور hash ِ بدنه را
   * کنار کلید نگه می‌دارد (`request-hash.ts`): همان کلید با بدنه‌ی دیگر ۴۰۹
   * می‌گیرد، نه پاسخ تکراری. FE-100 کل بدنه (نه فقط `effectiveAt`) را همراه
   * کلید سنجاق می‌کند و در sessionStorage نگه می‌دارد — مثل خودِ پیش‌نویس:
   * ترک جادوگر یا تازه‌سازی پس از پاسخ گم‌شده، فروش دوم نمی‌سازد.
   */
  const {
    submit: runSubmit,
    pending,
    locked,
    uncertain,
    isSubmitting,
    reset: resetKey,
    offline,
  } = useFinancialSubmit(post, { persist: { scope: 'sale:jewelry', schema: saleSubmitPayloadSchema } });

  /*
   * `effectiveAt` لحظه‌ی هر رندر است، نه لحظه‌ی ضربه — ولی فقط برای
   * سنجش «آیا ثبت مجاز است؟» استفاده می‌شود؛ payloadی که واقعاً ارسال
   * می‌شود در خودِ `submit` دوباره و با زمان همان لحظه ساخته می‌شود.
   */
  const preparation = prepareJewelrySale({ party, items, lockedMazneh, paidRial }, new Date());

  const submit = useCallback(async () => {
    const prepared = prepareJewelrySale({ party, items, lockedMazneh, paidRial }, new Date());
    /*
     * رسید به مشتری و نرخ قفل‌شده نیاز دارد — هر دو در پیش‌نویس sessionStorage هستند و جادوگر
     * تا پاسخ قطعی قفل است، پس برای تلاش سنجاق‌شده هم سر جایشان‌اند. بدون تلاش سنجاق‌شده،
     * `prepared.ok` همان شرط‌ها را از قبل گرفته؛ تکرارش فقط برای narrowing تایپ است.
     */
    if (party === null || lockedMazneh === null) return;
    // تلاش سنجاق‌شده بر پیش‌نویس مقدم است (هوک هم همین را تضمین می‌کند)
    const payload = pending?.payload ?? (prepared.ok ? prepared.plan.payload : null);
    if (payload === null) return;

    setError(null);
    try {
      const sale = await runSubmit(payload);
      if (!sale) return; // ضربه‌ی دوم حین ارسال قبلی — بی‌اثر، نه خطا

      const preview = prepared.ok ? prepared.plan.previewPayableRial : undefined;
      const receivableRial = 'receivableRial' in sale ? sale.receivableRial : 0n;
      setOutcome({
        sale,
        party,
        lockedMazneh,
        previewMismatchRial:
          preview !== undefined && preview !== sale.payableRial ? sale.payableRial - preview : undefined,
        mode: payload.mode,
        // مانده از سرور می‌آید؛ پرداخت‌شده باقیمانده‌ی همان دو عدد سرور است، نه عددی که کلاینت فرستاده
        paidRial: sale.payableRial - receivableRial,
        receivableRial,
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
        queryClient.invalidateQueries({ queryKey: queryKeys.salesInvoices.all() }),
        // «معاملات اخیر» ِ خانه و گزارش سود هم این فروش را نشان می‌دهند (M-22).
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.reports.all() }),
      ]);

      toast.success('فروش ثبت شد', `${formatRial(sale.payableRial)} ریال`);
      // موفقیت قطعی — کلید تازه برای فروش بعدی، و پیش‌نویس خالی
      resetKey();
      resetDraft();
    } catch (caught) {
      // پیش‌نویس دست‌نخورده می‌ماند تا کاربر بتواند اصلاح کند و دوباره بزند
      setError(caught);
    }
  }, [party, items, lockedMazneh, paidRial, pending, runSubmit, queryClient, resetKey, resetDraft]);

  const startNewSale = useCallback(() => {
    setOutcome(null);
    setError(null);
    resetDraft();
  }, [resetDraft]);

  return { preparation, isSubmitting, locked, uncertain, offline, error, outcome, submit, startNewSale };
}
