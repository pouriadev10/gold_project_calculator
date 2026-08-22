import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { JewelryWageType, PriceQuoteSource } from '@/api/contracts';
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
 * فقط مظنه (قفل‌شونده)، مشتری و اقلام اینجا state واقعی دارند. پرداخت
 * shape خودش را در تسک اختصاصی خودش می‌گیرد (FE-050) — طراحی زودهنگام
 * شکلش اینجا حدس‌زدن بدون داده است.
 */

export const SALE_STEPS = ['QUOTE', 'PARTY', 'ITEMS', 'PAYMENT', 'REVIEW'] as const;
export type SaleStep = (typeof SALE_STEPS)[number];

/**
 * یک ردیف انتخاب‌شده در مرحله‌ی اقلام — FE-042.
 *
 * `CATALOG` فقط ارجاع نگه می‌دارد (`jewelryItemId` + کد/عنوان برای
 * نمایش سبد) — مشخصات مالی کامل (وزن، عیار، کسورات، اجرت) را FE-043
 * («ویرایش ردیف فروش زیورآلات») خودش دوباره از همان کالا می‌خواند و
 * قابل‌ویرایش می‌کند. نگه‌داشتن یک رونوشت از آن‌ها همین‌جا یعنی دو منبع
 * حقیقت که می‌توانند از هم جدا بیفتند — دقیقاً همان چیزی که مستندات
 * `jewelryItemVersionSchema` درباره‌ی وزن خالص هشدار می‌دهد.
 *
 * `ADHOC` برخلافش هیچ `jewelryItemId`ای برای رجوع دوباره ندارد — پس
 * هرچه «ورود سریع وزن» (تمام‌است‌وقتی این تسک) همین‌جا گرفته (وزن،
 * عیار) باید همین‌جا نگه داشته شود، وگرنه در FE-043 گم می‌شود. کسورات و
 * اجرت کالای موردی هم دقیقاً مثل کاتالوگ به FE-043 موکول شده‌اند — این
 * تسک فقط «ورود سریع وزن» می‌خواهد، نه یک فرم مالی کامل.
 *
 * تکرار یک `jewelryItemId` در چند ردیف عمدی و مجاز است: هر ردیف یک
 * قطعه‌ی فیزیکی مجزاست (بخش ۲-۲ CLAUDE.md به‌طور مشابه درباره‌ی سکه) —
 * فروش دو انگشتر هم‌کد یعنی دو ردیف، نه یک ردیف با «تعداد ۲»، چون
 * `createJewelryCashSaleSchema`/`createJewelryCreditSaleSchema` واقعی
 * (`packages/contracts/src/sales`) اصلاً فیلد تعداد ندارند و هرکدام
 * دقیقاً یک `jewelryItemId` می‌پذیرند.
 *
 * ⚠️ همان دو قرارداد واقعی امروز فقط یک `jewelryItemId` **واحد** در هر
 * فروش می‌پذیرند و هیچ مفهوم «کالای موردی» ندارند. تطبیق این سبد
 * چندقلمی با آن قرارداد تک‌قلمی صریحاً کار FE-045/FE-047 است — همان‌جا
 * که FE-045 برای فروش نقدی همین کار را کرد: هر ثبت دقیقاً یک ردیف
 * کاتالوگی می‌فرستد و سبد چندقلمی/موردی صریحاً مسدود می‌شود
 * (`features/sales/sale-submit.ts`)، نه اینکه بی‌صدا قلم‌ها را بیندازد.
 *
 * `pricing` — FE-043 («ویرایش ردیف فروش زیورآلات») — تا وقتی کاربر
 * ویرایشگر ردیف را باز نکرده `null` است. مشخصات مالی کامل و
 * قابل‌ویرایش را نگه می‌دارد (وزن، عیار، کسورات، اجرت، نرخ سود، نرخ
 * مالیات) — نه نتیجه‌ی محاسبه‌شده: مبلغ‌های نهایی («نتیجه نهایی
 * server-authoritative» طبق قاعده‌ی خودِ FE-043) هرگز اینجا ذخیره
 * نمی‌شوند، همیشه از روی `pricing` + مظنه‌ی زنده با
 * `calculateLinePricing` (`features/sales/sale-line-pricing.ts`)
 * دوباره محاسبه می‌شوند، هرجا لازم باشد.
 */
export interface SaleLinePricingInput {
  readonly grossWeightMg: string;
  readonly karat: number;
  readonly stoneWeightMg: string;
  readonly otherDeductionWeightMg: string;
  readonly wageType: JewelryWageType;
  readonly wageValue: string;
  readonly profitRateBps: string;
  readonly taxRateBps: string;
}

/**
 * مظنه‌ی قفل‌شده برای مرحله‌ی مرور — FE-044.
 *
 * فقط رکورد خام (`mazneh` = مظنه‌ی مثقالی ریالی، همانی که `calculateLinePricing`
 * به‌عنوان `maznehRial` می‌خواهد)، نه هیچ عدد مشتق‌شده‌ای — نرخ گرم و
 * مبلغ‌های نهایی همیشه دوباره با `calculateLinePricing`/`gramRate1000`
 * از روی همین یک عدد محاسبه می‌شوند (دقیقاً همان قاعده‌ی «نتیجه نهایی
 * server-authoritative، هیچ عدد مشتق‌شده‌ای ذخیره نشود» که `SaleLinePricingInput`
 * هم از آن پیروی می‌کند).
 *
 * اولین باری که کاربر به مرحله‌ی «مرور» می‌رسد، مظنه‌ی زنده‌ی همان لحظه
 * اینجا قفل می‌شود (`lockMazneh`) و تا `reset` تغییر نمی‌کند — حتی اگر
 * کاربر برگردد و دوباره به مرور بیاید. این دقیقاً همان چیزی است که تسک
 * می‌خواهد: «تغییر مظنه بازار preview ثبت‌شده را بی‌صدا عوض نکند».
 */
export interface LockedMazneh {
  /**
   * شناسه‌ی رکورد مظنه روی سرور — همان چیزی که `createJewelryCashSaleSchema`
   * به‌عنوان `quoteId` می‌خواهد (FE-045). `mazneh` زیرش فقط برای **نمایش**
   * همین صفحه و محاسبه‌ی پیش‌نمایش است؛ مبلغ نهایی سند را سرور از روی
   * همین شناسه می‌سازد، نه از عددی که کلاینت فرستاده.
   */
  readonly quoteId: string;
  readonly mazneh: string;
  readonly source: PriceQuoteSource;
  readonly observedAt: string;
}

export type SaleDraftItemLine =
  | {
      readonly lineId: string;
      readonly kind: 'CATALOG';
      readonly jewelryItemId: string;
      readonly code: string;
      readonly title: string;
      readonly pricing: SaleLinePricingInput | null;
    }
  | {
      readonly lineId: string;
      readonly kind: 'ADHOC';
      readonly jewelryItemId: null;
      readonly code: string;
      readonly title: string;
      readonly grossWeightMg: string;
      readonly karat: number;
      readonly pricing: SaleLinePricingInput | null;
    };

interface SaleDraftState {
  readonly step: SaleStep;
  readonly party: PartySelection | null;
  readonly items: readonly SaleDraftItemLine[];
  readonly lockedMazneh: LockedMazneh | null;
  readonly goToStep: (step: SaleStep) => void;
  readonly next: () => void;
  readonly back: () => void;
  readonly setParty: (party: PartySelection | null) => void;
  readonly setItems: (items: readonly SaleDraftItemLine[]) => void;
  /** فقط یک‌بار برای هر پیش‌نویس اثر می‌کند — فراخوانی دوباره بعد از اولین قفل، بی‌صدا نادیده گرفته می‌شود. */
  readonly lockMazneh: (snapshot: LockedMazneh) => void;
  readonly reset: () => void;
}

export const SALE_DRAFT_STORAGE_KEY = 'gold-ui-sale-draft';

export const useSaleDraftStore = create<SaleDraftState>()(
  persist(
    (set, get) => ({
      step: 'QUOTE',
      party: null,
      items: [],
      lockedMazneh: null,
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
      setItems: (items) => set({ items }),
      lockMazneh: (snapshot) => {
        if (get().lockedMazneh !== null) return;
        set({ lockedMazneh: snapshot });
      },
      reset: () => set({ step: 'QUOTE', party: null, items: [], lockedMazneh: null }),
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
export function hasSaleDraftProgress(state: Pick<SaleDraftState, 'step' | 'party' | 'items'>): boolean {
  return state.step !== 'QUOTE' || state.party !== null || state.items.length > 0;
}
