import { z } from 'zod';
import {
  bigIntStringSchema,
  isoDateTimeSchema,
  priceQuoteAmountRialSchema,
  priceQuoteSchema as sharedPriceQuoteSchema,
} from '@gold/contracts';

/**
 * قرارداد API — لایه‌ی مصرف در فرانت.
 *
 * دو دسته‌ی متفاوت اینجا کنار هم‌اند، عمداً جدا نشانه‌گذاری شده:
 *
 * ۱. **از `@gold/contracts` re-export می‌شود** — شکلی که بک‌اند همین امروز
 *    پیاده کرده (BE-003 به بعد). این‌ها را اینجا دوباره تعریف نکن؛ اگر
 *    شکلشان باید عوض شود، تغییر در `packages/contracts` است، نه اینجا.
 * ۲. **View model محلی** — یا هنوز endpoint واقعی در بک‌اند ندارد (گزارش
 *    سود، معاملات اخیر، خلاصه‌ی مانده)، یا یک تجمیع UI-محور روی چند
 *    concept واقعی است (جست‌وجوی کالا). این‌ها با MSW نگه داشته می‌شوند تا
 *    endpoint واقعی برسد.
 *
 * قاعده‌ی طلایی هر دو دسته یکی است: **هیچ مقدار پولی یا وزنی روی سیم
 * `number` نیست.**
 */

/* ══════════════ از @gold/contracts (منبع مشترک با بک‌اند) ══════════════ */

export {
  apiErrorSchema,
  type ApiError as ApiErrorBody,
  partyTypeSchema,
  partySchema,
  partyListSchema,
  partyListQuerySchema,
  type Party,
  type PartyList,
  type PartyListQuery,
  loginSchema,
  sessionResponseSchema,
  refreshSchema,
  roleCodeSchema,
  priceQuoteTypeSchema,
  priceQuoteSourceSchema,
  priceQuoteAmountRialSchema,
  createManualPriceQuoteSchema,
  type LoginInput,
  type SessionResponse,
  type RefreshInput,
  type RoleCode,
  type PriceQuoteType,
  type CreateManualPriceQuoteInput,
} from '@gold/contracts';

/* ══════════════ View model محلی — بدون endpoint واقعی هنوز ══════════════ */

/**
 * رشته‌ی ارقام صحیح روی سیم → `bigint` در برنامه.
 * قاعده‌ی اعتبارسنجی (چه رشته‌ای مجاز است) از `@gold/contracts` می‌آید —
 * همان چیزی که بک‌اند هم بررسی می‌کند؛ تبدیل به `bigint` فقط اینجا لازم
 * است چون مصرف‌کننده‌ی نهایی (`core-calc`, JSX) به مقدار عددی نیاز دارد،
 * نه رشته.
 */
const bigintString = bigIntStringSchema.transform((value) => BigInt(value));

/** عیار — عدد صحیح کوچک، پس `number` اینجا بی‌خطر است. */
const karatNumber = z.number().int().min(1).max(1000);

/* ── مبلغ دومقیاسه ─────────────────────────────────────────── */

/**
 * ترکیب ریال + معادل طلای خالص با نرخ قفل‌شده — شکل نمایشی، نه یک DTO
 * سیمی واحد. هیچ endpointای دقیقاً همین سه فیلد را کنار هم برنمی‌گرداند؛
 * صفحاتی که به بک‌اند واقعی وصل می‌شوند این را از یک مبلغ + نرخ snapshot
 * خودشان می‌سازند (`@gold/core-calc`: `dualFromRial` / `dualFromPure`).
 */
export const dualAmountSchema = z.object({
  rial: bigintString,
  pureMg: bigintString,
  /** مظنه‌ی قفل‌شده در لحظه‌ی رویداد — قاعده‌ی ۲-۸ CLAUDE.md */
  rate1000: bigintString,
});
export type DualAmountDto = z.infer<typeof dualAmountSchema>;

/* ── GET /api/pricing/quotes/latest — FE-029/BE-021 ──────────── */

/**
 * آینه‌ی `priceQuoteSchema` واقعی (`@gold/contracts`)، فقط با
 * `amountRial` به `bigint` تبدیل‌شده — قرارداد پایه از بک‌اند می‌آید و
 * اینجا دوباره تعریف نمی‌شود، فقط برای مصرف در `core-calc`/JSX یک قدم
 * تبدیل اضافه می‌شود، دقیقاً مثل بقیه‌ی مقادیر پولی این فایل.
 *
 * فقط **رکورد خام مظنه** است — نرخ هر عیار (گرم ۷۵۰ و ...) اینجا محاسبه
 * نمی‌شود؛ آن حساب سمت مصرف‌کننده با `gramRate` از `core-calc` انجام
 * می‌شود (`useMazneh.ts`)، چون مبنای تبدیل ثابت است و نیازی به رفت‌وبرگشت
 * با سرور ندارد.
 */
export const priceQuoteSchema = sharedPriceQuoteSchema.extend({
  amountRial: priceQuoteAmountRialSchema.transform((value) => BigInt(value)),
});
export type PriceQuote = z.infer<typeof priceQuoteSchema>;
/** `@gold/contracts` این را جدا export نمی‌کند؛ اینجا از خودِ `PriceQuote` گرفته می‌شود. */
export type PriceQuoteSource = PriceQuote['source'];

/* ── GET /api/pricing/quotes — FE-031/BE-021 ─────────────────── */

/**
 * تاریخچه‌ی مظنه. بک‌اند صفحه‌بندی سرور-محور ندارد
 * (`priceQuoteQuerySchema` فقط `quoteType` اختیاری دارد؛ `list()` در
 * `price-quotes.service.ts` کل فهرست tenant را برمی‌گرداند، مرتب بر
 * اساس `observedAt` نزولی) — pagination در `QuoteHistoryList` سمت
 * کلاینت روی همین آرایه انجام می‌شود.
 */
export const priceQuoteListSchema = z.array(priceQuoteSchema);
export type PriceQuoteList = z.infer<typeof priceQuoteListSchema>;

/* ── GET /api/parties/balance-summary ──────────────────────── */

/** جمع بدهکار/بستانکار روی همه‌ی اشخاص. بدون معادل بک‌اندی هنوز (BE-056/BE-058). */
export const partyBalanceSummarySchema = z.object({
  credit: dualAmountSchema,
  debit: dualAmountSchema,
  net: dualAmountSchema,
  creditPartyCount: z.number().int().nonnegative(),
  debitPartyCount: z.number().int().nonnegative(),
});
export type PartyBalanceSummary = z.infer<typeof partyBalanceSummarySchema>;

/* ── GET /api/items ────────────────────────────────────────── */

/**
 * جست‌وجوی یکپارچه‌ی زیورآلات + آبشده + سکه — یک تجمیع UI-محور است، نه یک
 * DTO واحد بک‌اندی. سه concept واقعی که این را می‌سازند، هر سه در
 * `@gold/contracts`: `jewelryItemVersionSchema` (زیورآلات)،
 * `coinTypeVersionSchema` (مشخصات مرجع سکه) + `inventoryBalanceSchema`
 * (موجودی سکه/آبشده). وقتی FE-036/FE-038 به بک‌اند واقعی وصل شوند، این
 * schema یا به چند فراخوانی جدا تبدیل می‌شود یا بک‌اند یک endpoint
 * تجمیعی مشابه اضافه می‌کند.
 */
export const itemKindSchema = z.enum(['article', 'melted', 'coin']);
export type ItemKind = z.infer<typeof itemKindSchema>;

export const itemSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  kind: itemKindSchema,
  karat: karatNumber.nullable(),
  /** وزن ناخالص — برای سکه `null` است، چون سکه شمارشی است نه وزنی */
  grossMg: bigintString.nullable(),
  /** موجودی: برای سکه تعداد، برای بقیه میلی‌گرم */
  stockCount: z.number().int().nullable(),
  stockMg: bigintString.nullable(),
});
export type Item = z.infer<typeof itemSchema>;

export const itemListSchema = z.object({
  items: z.array(itemSchema),
  total: z.number().int().nonnegative(),
});

/* ── GET /api/reports/profit ───────────────────────────────── */

/** بدون معادل بک‌اندی هنوز — گزارش‌ها Milestone 17 هستند (BE-058 تا BE-060). */
export const profitPeriodSchema = z.enum(['today', 'month']);
export type ProfitPeriod = z.infer<typeof profitPeriodSchema>;

export const profitReportSchema = z.object({
  period: profitPeriodSchema,
  /** اجرت و حاشیه‌ی فروش */
  operational: dualAmountSchema,
  /** تغییر قیمت طلا روی موجودی — این مهارت نیست، بازار است */
  fluctuation: dualAmountSchema,
  /** فقط سکه‌ی ضرب بانک مرکزی حباب دارد */
  coinBubble: dualAmountSchema,
  total: dualAmountSchema,
  /** درصد در مقیاس ۱۰ — یک رقم اعشار، بدون شناور */
  percentX10: bigintString,
});
export type ProfitReport = z.infer<typeof profitReportSchema>;

/* ── GET /api/transactions/recent ──────────────────────────── */

/** بدون معادل بک‌اندی هنوز — دفتر کل اسکلت خالی است (`ledger/index.ts`, BE-037). */
export const transactionKindSchema = z.enum(['sale', 'purchase', 'second-hand', 'coin-sale']);
export type TransactionKind = z.infer<typeof transactionKindSchema>;

export const transactionSchema = z.object({
  id: z.string(),
  partyName: z.string(),
  kind: transactionKindSchema,
  title: z.string(),
  amount: dualAmountSchema,
  occurredAt: isoDateTimeSchema,
});
export type Transaction = z.infer<typeof transactionSchema>;

export const transactionListSchema = z.object({
  items: z.array(transactionSchema),
});

/* ── POST /api/invoices ────────────────────────────────────── */

/**
 * ⚠️ این mock قدیمی‌تر از قرارداد واقعی فروش است و دیگر شکلش را ندارد —
 * از قبل از این‌که `@gold/contracts` قرارداد فروش داشته باشد ساخته شده.
 *
 * قرارداد واقعی دو endpoint جدا دارد، هرکدام **یک قلم کالا** و یک
 * `quoteId` می‌گیرند، نه آرایه‌ای از خطوط با مظنه‌ی خام:
 * `createJewelryCashSaleSchema` / `jewelryCashSaleSchema` (نقدی) و
 * `createJewelryCreditSaleSchema` / `jewelryCreditSaleSchema` (نسیه) —
 * هر دو در `@gold/contracts`.
 *
 * جایگزینی این mock کار FE-045 (وابسته به BE-041) و FE-047 (وابسته به
 * BE-042) است، نه یک import-swap ساده در همین تسک — چون شکل درخواست هم
 * عوض می‌شود، نه فقط نام فیلدها. فعلاً هیچ صفحه‌ای این endpoint را صدا
 * نمی‌زند (بدون مصرف‌کننده‌ی UI).
 */
export const invoiceLineInputSchema = z.object({
  itemId: z.string(),
  /** برای سکه تعداد، برای بقیه `null` */
  count: z.number().int().positive().nullable(),
  /** برای مصنوع و آبشده میلی‌گرم، برای سکه `null` */
  grossMg: bigintString.nullable(),
  karat: karatNumber.nullable(),
  wageRial: bigintString,
});

export const createInvoiceInputSchema = z.object({
  partyId: z.string(),
  lines: z.array(invoiceLineInputSchema).min(1),
  /** مظنه‌ی لحظه‌ی ثبت — سند نرخ خودش را حمل می‌کند */
  maznehRial: bigintString,
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceInputSchema>;

export const createInvoiceResultSchema = z.object({
  id: z.string(),
  /** شماره‌ی بدون شکاف — بخش ۵ CLAUDE.md */
  number: z.string(),
  total: dualAmountSchema,
  createdAt: isoDateTimeSchema,
});
export type CreateInvoiceResult = z.infer<typeof createInvoiceResultSchema>;
