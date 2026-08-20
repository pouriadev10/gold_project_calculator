import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PartySelection } from './recent-parties-store';

/**
 * پیش‌نویس فروش زیورآلات — shell جریان فروش سریع (FE-041).
 *
 * **فقط `sessionStorage`، نه `localStorage`** — قاعده‌ی صریح این تسک:
 * «حفظ draft local فقط در همان session» و «draft رسمی آفلاین ساخته
 * نشود». برخلاف `recent-parties-store.ts` (که عمداً `localStorage`
 * می‌گیرد چون یک راحتی چندجلسه‌ای بی‌خطر است)، این store داده‌ی نیمه‌کاره‌ی
 * یک فروش واقعی است — نباید روزها بعد در تب دیگری سر و کله‌اش پیدا شود.
 * بستن تب/مرورگر یعنی پاک‌شدن، دقیقاً همان معنای «session».
 *
 * فقط دو مرحله‌ی اول (مظنه، مشتری) اینجا state واقعی دارند. اقلام/پرداخت
 * shape خودشان را در تسک‌های اختصاصی خودشان می‌گیرند (FE-042 تا FE-044)
 * — طراحی زودهنگام شکلشان اینجا حدس‌زدن بدون داده است.
 */

export const SALE_STEPS = ['QUOTE', 'PARTY', 'ITEMS', 'PAYMENT', 'REVIEW'] as const;
export type SaleStep = (typeof SALE_STEPS)[number];

interface SaleDraftState {
  readonly step: SaleStep;
  readonly party: PartySelection | null;
  readonly goToStep: (step: SaleStep) => void;
  readonly next: () => void;
  readonly back: () => void;
  readonly setParty: (party: PartySelection | null) => void;
  readonly reset: () => void;
}

export const SALE_DRAFT_STORAGE_KEY = 'gold-ui-sale-draft';

export const useSaleDraftStore = create<SaleDraftState>()(
  persist(
    (set, get) => ({
      step: 'QUOTE',
      party: null,
      goToStep: (step) => set({ step }),
      next: () => {
        const index = SALE_STEPS.indexOf(get().step);
        // مرزها بالا-پایین همین‌جا چک شده‌اند — اندیس‌های داخل بازه تضمین‌شده‌اند
        if (index < SALE_STEPS.length - 1) set({ step: SALE_STEPS[index + 1]! });
      },
      back: () => {
        const index = SALE_STEPS.indexOf(get().step);
        if (index > 0) set({ step: SALE_STEPS[index - 1]! });
      },
      setParty: (party) => set({ party }),
      reset: () => set({ step: 'QUOTE', party: null }),
    }),
    {
      name: SALE_DRAFT_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

/**
 * آیا واقعاً چیزی برای از‌دست‌دادن هست؟ ماندن روی مرحله‌ی اول بدون هیچ
 * انتخابی «هنوز شروع نشده» است، نه یک draft — هشدار خروج برایش بی‌معناست.
 */
export function hasSaleDraftProgress(state: Pick<SaleDraftState, 'step' | 'party'>): boolean {
  return state.step !== 'QUOTE' || state.party !== null;
}
