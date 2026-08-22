import type { CreateJewelryCashSaleInput, CreateJewelryCreditSaleInput } from '@/api/contracts';
import type { LockedMazneh, SaleDraftItemLine } from '@/stores/sale-draft-store';
import type { PartySelection } from '@/stores/recent-parties-store';
import { calculateLinePricing } from './sale-line-pricing';

/**
 * ساخت payload ثبت فروش از پیش‌نویس — FE-045 (نقدی) و FE-047 (نسیه).
 *
 * **کدام مسیر؟** `draft.paidRial === null` یعنی «پرداخت کامل» →
 * `POST /sales/invoices/jewelry`. هر عدد دیگری، حتی صفر، یعنی نسیه →
 * `.../jewelry/credit` با همان عدد در `paidRial`. صفر عمداً نسیه است، نه
 * «پرداخت کامل»: فروش با پرداخت صفر یک بدهی کامل است و باید در حساب شخص
 * بنشیند، نه در صندوق.
 *
 * مبلغ پرداختی **با جمع کل کلاینت مقایسه نمی‌شود** و «بیشتر از مبلغ
 * فاکتور» اینجا رد نمی‌شود — جمع کل کلاینت فقط پیش‌نمایش است و مبلغ واقعی
 * سند را سرور می‌زند. `nonNegativeBigIntStringSchema` تنها قاعده‌ای است که
 * قرارداد می‌گذارد (منفی نباشد) و همان اینجا اجرا می‌شود؛ بقیه‌اش تصمیم
 * سرور است، نه حدس کلاینت.
 *
 * ⚠️ **چرا این تابع می‌تواند «نه» بگوید.** سبد فروش (FE-042) چندقلمی است
 * و قلم موردی هم می‌پذیرد، ولی `createJewelryCashSaleSchema` واقعی
 * (`packages/contracts/src/sales/jewelry-cash-sales.ts`، `.strict()`)
 * دقیقاً یک `jewelryItemId` می‌گیرد و هیچ مفهومی از کالای بدون شناسه
 * ندارد — `JewelryCashSalesController` هم همان یک شناسه را به
 * `SalesPricingService` می‌دهد و یک ردیف در فاکتور می‌سازد. این شکاف از
 * FE-042 مستند بود و حل‌کردنش صریحاً به همین تسک واگذار شده بود.
 *
 * دو راه غلط وجود داشت و هر دو کنار گذاشته شدند:
 *
 * ۱. **چند درخواست، یکی به‌ازای هر قلم.** یک فروش را به چند فاکتور با
 *    چند شماره‌ی مستقل تبدیل می‌کند — مشتری یک رسید می‌خواهد، دفتر کل هم
 *    یک سند. «شماره فاکتور بدون شکاف» (بخش ۵ CLAUDE.md) هم معنایش را
 *    از دست می‌دهد وقتی یک خرید سه شماره بگیرد.
 * ۲. **فرستادن قلم اول و انداختن بقیه.** بی‌صدا مبلغ کمتری ثبت می‌کند.
 *    هیچ عدد مالی در این محصول نباید ساکت غلط شود.
 *
 * پس راه سوم: تا وقتی بک‌اند فاکتور چندقلمی ندارد، ثبت فقط برای همان
 * شکلی که بک‌اند واقعاً پشتیبانی می‌کند باز است و بقیه‌ی حالت‌ها با پیام
 * صریح **مسدود** می‌شوند. کاربر دقیقاً می‌داند چرا نمی‌تواند ثبت کند.
 *
 * ⚠️ **قیمت‌گذاری ردیف اینجا فرستاده نمی‌شود.** ویرایش‌های FE-043 (وزن،
 * عیار، کسورات، اجرت، سود، مالیات) در قرارداد جایی ندارند؛ سرور از روی
 * نسخه‌ی جاری همان کالا و `quoteId` قیمت می‌زند. یعنی خروجی
 * `calculateLinePricing` فقط **پیش‌نمایش** است و می‌تواند با عدد سرور
 * فرق کند — به همین دلیل `previewPayableRial` هم اینجا محاسبه می‌شود، تا
 * صفحه بتواند بعد از پاسخ، اختلاف را نشان دهد (قاعده‌ی «mismatch سرور و
 * کلاینت نمایش و کنترل شود»، FE-043).
 */

export type SaleSubmitBlockReason =
  | 'NO_PARTY'
  | 'NO_QUOTE'
  | 'NO_ITEMS'
  | 'MULTIPLE_ITEMS'
  | 'ADHOC_ITEM'
  | 'ITEM_NOT_PRICED'
  | 'NEGATIVE_PAYMENT';

const BLOCK_MESSAGE: Record<SaleSubmitBlockReason, string> = {
  NO_PARTY: 'مشتری انتخاب نشده است.',
  NO_QUOTE: 'نرخ این فاکتور هنوز قفل نشده — چند لحظه صبر کنید تا مظنه دریافت شود.',
  NO_ITEMS: 'هیچ قلمی در فاکتور نیست.',
  MULTIPLE_ITEMS:
    'فروش نقدی فعلاً فقط با یک قلم کالا ثبت می‌شود. اقلام اضافه را از مرحله‌ی «اقلام» حذف کنید و برای بقیه فاکتور جدا بزنید.',
  ADHOC_ITEM:
    'کالای موردی هنوز قابل ثبت نیست — فقط کالایی که در انبار ثبت شده باشد فروخته می‌شود. کالا را از «کالای زیورآلات» ثبت کنید و دوباره انتخاب کنید.',
  ITEM_NOT_PRICED: 'این قلم هنوز قیمت‌گذاری نشده — از مرحله‌ی «اقلام» بازش کنید و مشخصاتش را کامل کنید.',
  NEGATIVE_PAYMENT: 'مبلغ پرداختی نمی‌تواند منفی باشد.',
};

/** نقدی یا نسیه — تعیین‌کننده‌ی endpoint، سند حسابداری و شکل رسید. */
export type SaleMode = 'CASH' | 'CREDIT';

export type SaleSubmitPayload =
  | { readonly mode: 'CASH'; readonly input: CreateJewelryCashSaleInput }
  | { readonly mode: 'CREDIT'; readonly input: CreateJewelryCreditSaleInput };

export interface SaleSubmitPlan {
  readonly payload: SaleSubmitPayload;
  /**
   * مبلغ پیش‌نمایش کلاینت در لحظه‌ی ساخت payload. **مبلغ سند نیست** —
   * فقط برای مقایسه با `payableRial` پاسخ سرور نگه داشته می‌شود.
   * `undefined` یعنی محاسبه‌ی محلی خطا داد؛ خودِ ثبت هنوز معتبر است چون
   * سرور مستقل حساب می‌کند.
   */
  readonly previewPayableRial: bigint | undefined;
}

export type SaleSubmitPreparation =
  | { readonly ok: true; readonly plan: SaleSubmitPlan }
  | { readonly ok: false; readonly reason: SaleSubmitBlockReason; readonly message: string };

function blocked(reason: SaleSubmitBlockReason): SaleSubmitPreparation {
  return { ok: false, reason, message: BLOCK_MESSAGE[reason] };
}

export interface SaleDraftSnapshot {
  readonly party: PartySelection | null;
  readonly items: readonly SaleDraftItemLine[];
  readonly lockedMazneh: LockedMazneh | null;
  /** `null` = پرداخت کامل (نقدی). هر عدد دیگری = نسیه. */
  readonly paidRial: string | null;
}

/**
 * `effectiveAt` صریح آرگومان است، نه `new Date()` داخل تابع: این تابع
 * خالص می‌ماند و تست‌ها بدون دستکاری ساعت سیستم می‌توانند خروجی دقیق را
 * بسنجند.
 */
export function prepareJewelrySale(draft: SaleDraftSnapshot, effectiveAt: Date): SaleSubmitPreparation {
  if (draft.party === null) return blocked('NO_PARTY');
  if (draft.lockedMazneh === null) return blocked('NO_QUOTE');
  if (draft.items.length === 0) return blocked('NO_ITEMS');
  if (draft.items.length > 1) return blocked('MULTIPLE_ITEMS');

  // بالا تضمین شد دقیقاً یک عضو دارد
  const line = draft.items[0]!;
  if (line.kind === 'ADHOC') return blocked('ADHOC_ITEM');
  if (line.pricing === null) return blocked('ITEM_NOT_PRICED');
  if (draft.paidRial !== null && BigInt(draft.paidRial) < 0n) return blocked('NEGATIVE_PAYMENT');

  const preview = calculateLinePricing(line.pricing, BigInt(draft.lockedMazneh.mazneh));
  const common = {
    partyId: draft.party.id,
    jewelryItemId: line.jewelryItemId,
    quoteId: draft.lockedMazneh.quoteId,
    effectiveAt: effectiveAt.toISOString(),
  };

  return {
    ok: true,
    plan: {
      payload:
        draft.paidRial === null
          ? { mode: 'CASH', input: common }
          : { mode: 'CREDIT', input: { ...common, paidRial: draft.paidRial } },
      previewPayableRial: preview.ok ? preview.calc.payableRial : undefined,
    },
  };
}
