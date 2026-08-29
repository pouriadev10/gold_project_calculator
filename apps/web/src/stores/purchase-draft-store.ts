import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PartySelection } from './recent-parties-store';

/**
 * پیش‌نویس خرید طلای دست‌دوم — shell جریان خرید (FE-056).
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
 * FE-059)، نه مرحله‌ای که ورودی‌ای برای ردشدن داشته باشد — همان الگوی
 * رسید فروش (`SaleReceipt`، FE-046) که جای کل ویزارد می‌نشیند.
 * `NAVIGABLE_STEPS` مرز پیمایش را همین‌جا قفل می‌کند.
 *
 * **فیلدها فقط تا جای واقعی امروز.** فروشنده اینجا state واقعی دارد
 * (`PartySelector`، FE-035). وزن/کسورات/عیار/مبلغ/پرداخت shape خودشان را
 * در تسک اختصاصی‌شان می‌گیرند (FE-057/FE-059) — طراحی زودهنگام شکلشان
 * اینجا حدس‌زدن بدون داده است. دو تصمیم از قبل قفل شده‌اند:
 * - **عیار خرید:** هیچ مقداری در UI هاردکد نمی‌شود (قاعده‌ی تسک). قرارداد
 *   واقعی (`createSecondHandGoldPurchaseSchema`) `purchaseKarat` را
 *   اختیاری می‌گیرد و نبودش یعنی «پیش‌فرض نسخه‌دار مستأجر را خود سرور
 *   اعمال کن» — مسیر پیش‌فرضِ بدون هاردکد همین است.
 * - **مقصد کالا:** سرور همیشه `MELTED_GOLD` می‌سازد
 *   (`second-hand-gold-purchases.service.ts`) و ورودی مقصد اصلاً وجود
 *   ندارد؛ UI فقط همین پیش‌فرض را نمایش می‌دهد.
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
export const NAVIGABLE_PURCHASE_STEPS = ['SELLER', 'WEIGHING', 'DEDUCTIONS', 'KARAT', 'QUOTE', 'AMOUNT', 'PAYMENT'] as const;

interface PurchaseDraftState {
  readonly step: PurchaseStep;
  /** فروشنده — خرید دست‌دوم فقط از مصرف‌کننده است (سرور: `SecondHandPurchasePartyNotConsumerError`). */
  readonly seller: PartySelection | null;
  readonly goToStep: (step: PurchaseStep) => void;
  readonly next: () => void;
  readonly back: () => void;
  readonly setSeller: (seller: PartySelection | null) => void;
  readonly reset: () => void;
}

export const PURCHASE_DRAFT_STORAGE_KEY = 'gold-ui-purchase-draft';

export const usePurchaseDraftStore = create<PurchaseDraftState>()(
  persist(
    (set, get) => ({
      step: 'SELLER',
      seller: null,
      goToStep: (step) => set({ step }),
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
      setSeller: (seller) => set({ seller }),
      reset: () => set({ step: 'SELLER', seller: null }),
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
export function hasPurchaseDraftProgress(state: Pick<PurchaseDraftState, 'step' | 'seller'>): boolean {
  return state.step !== 'SELLER' || state.seller !== null;
}
