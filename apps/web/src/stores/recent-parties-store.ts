import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PartyType, PartyStatus } from '@/api/contracts';

/**
 * اشخاص اخیر — FE-035.
 *
 * هیچ endpointای برای «اخیر» وجود ندارد (نه `GET /parties` مرتب‌سازی
 * بر این اساس دارد، نه هیچ concept دیگری بک‌اندی) — این یک وضعیت
 * **کاملاً سمت کلاینت** است: هر بار `PartySelector` شخصی را انتخاب
 * می‌کند، یک رونوشت سبک از او را همین‌جا نگه می‌دارد تا دفعه‌ی بعد بدون
 * جست‌وجوی دوباره در دسترس باشد. مثل `unit-store.ts`، `localStorage`
 * اینجا فقط راحتی رابط کاربری است، نه داده‌ی مالی — و عمداً فقط
 * فیلدهای لازم برای نمایش/انتخاب نگه داشته می‌شود (نه کد ملی، نه
 * یادداشت) تا اطلاعات حساس‌تر بی‌جهت در `localStorage` ننشیند.
 *
 * چون این رونوشت می‌تواند از واقعیت سرور عقب بیفتد (مثلاً شخص بعداً
 * غیرفعال شده)، `PartySelector` هرگز آن را به‌عنوان تنها منبع حقیقت
 * برای وضعیت فرض نمی‌کند — فقط برای «نمایش سریع فهرست اخیر» است؛ خودِ
 * انتخاب هنوز طبق `status` همین رونوشت رد می‌شود اگر غیرفعال باشد.
 */

export interface PartySelection {
  readonly id: string;
  readonly displayName: string;
  readonly mobile: string | null;
  readonly type: PartyType;
  readonly status: PartyStatus;
}

/** بیشتر از این تعداد، فهرست «اخیر» را به یک فهرست کامل دیگر تبدیل می‌کند — هدفش یادآوری سریع است. */
const MAX_RECENT = 8;

interface RecentPartiesState {
  recent: readonly PartySelection[];
  recordSelection: (party: PartySelection) => void;
  clear: () => void;
}

export const RECENT_PARTIES_STORAGE_KEY = 'gold-ui-recent-parties';

export const useRecentPartiesStore = create<RecentPartiesState>()(
  persist(
    (set) => ({
      recent: [],
      recordSelection: (party) =>
        set((state) => ({
          // بدون تکرار — انتخاب دوباره‌ی همان شخص او را به بالای فهرست می‌آورد، نه یک ردیف تازه
          recent: [party, ...state.recent.filter((p) => p.id !== party.id)].slice(0, MAX_RECENT),
        })),
      clear: () => set({ recent: [] }),
    }),
    { name: RECENT_PARTIES_STORAGE_KEY },
  ),
);
