import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * کالای زیورآلات اخیر — FE-042.
 *
 * دقیقاً هم‌الگوی `recent-parties-store.ts` (FE-035): هیچ endpoint
 * بک‌اندی برای «اخیر» وجود ندارد، پس این یک وضعیت کاملاً سمت کلاینت
 * است — هر بار `JewelryItemSelector` کالایی از کاتالوگ انتخاب می‌کند
 * (نه کالای موردی؛ آن کد کاتالوگ ندارد که با آن بعداً پیدایش کرد و
 * هیچ‌وقت اینجا ثبت نمی‌شود) رونوشتی سبک از او نگه می‌دارد.
 *
 * `localStorage` (نه `sessionStorage`) — راحتی چندجلسه‌ای بی‌خطر، مثل
 * اشخاص اخیر؛ برخلاف خودِ `sale-draft-store.ts` که داده‌ی نیمه‌کاره‌ی
 * یک فروش واقعی است و نباید از یک جلسه به جلسه‌ی دیگر بماند.
 *
 * چون این رونوشت می‌تواند از واقعیت سرور عقب بیفتد (کالا بعداً
 * غیرفعال شده)، `active` هم نگه داشته می‌شود — انتخاب هنوز طبق همین
 * فیلد رد می‌شود اگر غیرفعال باشد، دقیقاً قاعده‌ی `PartySelector`.
 */

export interface RecentJewelryItem {
  readonly jewelryItemId: string;
  readonly code: string;
  readonly title: string;
  readonly grossWeightMg: string;
  readonly karat: number;
  readonly active: boolean;
}

/** بیشتر از این تعداد، فهرست «اخیر» را به یک فهرست کامل دیگر تبدیل می‌کند — هدفش یادآوری سریع است. */
const MAX_RECENT = 8;

interface RecentJewelryItemsState {
  recent: readonly RecentJewelryItem[];
  recordSelection: (item: RecentJewelryItem) => void;
  clear: () => void;
}

export const RECENT_JEWELRY_ITEMS_STORAGE_KEY = 'gold-ui-recent-jewelry-items';

export const useRecentJewelryItemsStore = create<RecentJewelryItemsState>()(
  persist(
    (set) => ({
      recent: [],
      recordSelection: (item) =>
        set((state) => ({
          // بدون تکرار — انتخاب دوباره‌ی همان کالا آن را به بالای فهرست می‌آورد، نه یک ردیف تازه
          recent: [item, ...state.recent.filter((i) => i.jewelryItemId !== item.jewelryItemId)].slice(
            0,
            MAX_RECENT,
          ),
        })),
      clear: () => set({ recent: [] }),
    }),
    { name: RECENT_JEWELRY_ITEMS_STORAGE_KEY },
  ),
);
