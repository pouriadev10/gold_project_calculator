import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PartySelection } from './recent-parties-store';

/**
 * پیش‌نویس خرید طلای دست‌دوم — shell و داده‌های وزن‌کشی جریان خرید (FE-056 / FE-057).
 *
 * **عمداً جدا از `sale-draft-store`** — قاعده‌ی صریح این تسک: «UI مستقل از
 * فروش باشد». خرید دست‌دوم از نظر حسابداری یک **خرید** است (بخش ۲-۵
 * CLAUDE.md)، نه برگشتِ فروش؛ store مشترک یعنی دو جریان که هر تغییر یکی
 * دیگری را می‌شکند. فایل، کلید storage و شکل داده همه مستقل‌اند.
 *
 * **فقط `sessionStorage`، نه `localStorage`** — همان قاعده‌ی پیش‌نویس فروش:
 * «حفظ draft local فقط در همان session» و «draft رسمی آفلاین ساخته نشود».
 * بستن تب/مرورگر یعنی پاک‌شدن.
 *
 * **مراحل — دقیقاً هشت مرحله‌ی تسک.** «رسید» آخرین آن‌هاست ولی با
 * «بعدی/قبلی» پیمایش نمی‌شود: رسید حالتِ پس از ثبت موفق است (کار
 * FE-059)، نه مرحله‌ای که ورودی‌ای برای ردشدن داشته باشد.
 */

export const PURCHASE_STEPS = [
  'SELLER',
  'WEIGHING',
  'DEDUCTIONS',
  'KARAT',
  'QUOTE',
  'AMOUNT',
  'PAYMENT',
  'RECEIPT',
] as const;
export type PurchaseStep = (typeof PURCHASE_STEPS)[number];

/** مراحلی که با «بعدی/قبلی» پیمایش می‌شوند — «رسید» فقط پس از ثبت موفق (FE-059). */
export const NAVIGABLE_PURCHASE_STEPS = [
  'SELLER',
  'WEIGHING',
  'DEDUCTIONS',
  'KARAT',
  'QUOTE',
  'AMOUNT',
  'PAYMENT',
] as const;

export const DEFAULT_PURCHASE_KARAT = 740;

export interface PurchaseDraftState {
  readonly step: PurchaseStep;
  /** فروشنده — خرید دست‌دوم فقط از مصرف‌کننده است (سرور: `SecondHandPurchasePartyNotConsumerError`). */
  readonly seller: PartySelection | null;
  /** وزن ناخالص کل به میلی‌گرم (رشته‌ای، بدون اعشار). */
  readonly grossWeightMg: string;
  /** وزن نگین به میلی‌گرم. */
  readonly stoneWeightMg: string;
  /** سایر کسورات و متعلقات به میلی‌گرم. */
  readonly otherDeductionWeightMg: string;
  /** عیار خرید انتخابی (۱ تا ۱۰۰۰). */
  readonly purchaseKarat: number;
  /** کارمزد اختیاری خرید به ریال. */
  readonly feeRial: string;

  readonly goToStep: (step: PurchaseStep) => void;
  readonly next: () => void;
  readonly back: () => void;
  readonly setSeller: (seller: PartySelection | null) => void;
  readonly setGrossWeightMg: (grossWeightMg: string) => void;
  readonly setStoneWeightMg: (stoneWeightMg: string) => void;
  readonly setOtherDeductionWeightMg: (otherDeductionWeightMg: string) => void;
  readonly setPurchaseKarat: (purchaseKarat: number) => void;
  readonly setFeeRial: (feeRial: string) => void;
  readonly reset: () => void;
}

export const PURCHASE_DRAFT_STORAGE_KEY = 'gold-ui-purchase-draft';

export const usePurchaseDraftStore = create<PurchaseDraftState>()(
  persist(
    (set, get) => ({
      step: 'SELLER',
      seller: null,
      grossWeightMg: '0',
      stoneWeightMg: '0',
      otherDeductionWeightMg: '0',
      purchaseKarat: DEFAULT_PURCHASE_KARAT,
      feeRial: '0',

      goToStep: (step) => {
        if (get().step !== step) set({ step });
      },
      next: () => {
        const index = NAVIGABLE_PURCHASE_STEPS.indexOf(
          get().step as (typeof NAVIGABLE_PURCHASE_STEPS)[number],
        );
        // «رسید» آخرین مرحله‌ی پیمایش‌پذیر نیست — از PAYMENT جلوتر با next نمی‌رود
        if (index >= 0 && index < NAVIGABLE_PURCHASE_STEPS.length - 1) {
          set({ step: NAVIGABLE_PURCHASE_STEPS[index + 1]! });
        }
      },
      back: () => {
        const index = NAVIGABLE_PURCHASE_STEPS.indexOf(
          get().step as (typeof NAVIGABLE_PURCHASE_STEPS)[number],
        );
        if (index > 0) set({ step: NAVIGABLE_PURCHASE_STEPS[index - 1]! });
      },
      setSeller: (seller) => {
        if (get().seller !== seller) set({ seller });
      },
      setGrossWeightMg: (grossWeightMg) => {
        if (get().grossWeightMg !== grossWeightMg) set({ grossWeightMg });
      },
      setStoneWeightMg: (stoneWeightMg) => {
        if (get().stoneWeightMg !== stoneWeightMg) set({ stoneWeightMg });
      },
      setOtherDeductionWeightMg: (otherDeductionWeightMg) => {
        if (get().otherDeductionWeightMg !== otherDeductionWeightMg) set({ otherDeductionWeightMg });
      },
      setPurchaseKarat: (purchaseKarat) => {
        if (get().purchaseKarat !== purchaseKarat) set({ purchaseKarat });
      },
      setFeeRial: (feeRial) => {
        if (get().feeRial !== feeRial) set({ feeRial });
      },
      reset: () =>
        set({
          step: 'SELLER',
          seller: null,
          grossWeightMg: '0',
          stoneWeightMg: '0',
          otherDeductionWeightMg: '0',
          purchaseKarat: DEFAULT_PURCHASE_KARAT,
          feeRial: '0',
        }),
    }),
    {
      name: PURCHASE_DRAFT_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

/**
 * آیا واقعاً چیزی برای از‌دست‌دادن هست؟ ماندن روی مرحله‌ی اول بدون هیچ
 * انتخابی «هنوز شروع نشده» است، نه یک draft — هشدار خروج برایش بی‌معناست.
 */
export function hasPurchaseDraftProgress(
  state: Pick<PurchaseDraftState, 'step' | 'seller' | 'grossWeightMg' | 'feeRial'>,
): boolean {
  return (
    state.step !== 'SELLER' ||
    state.seller !== null ||
    state.grossWeightMg !== '0' ||
    state.feeRial !== '0'
  );
}
