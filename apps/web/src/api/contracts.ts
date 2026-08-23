import { z } from 'zod';
import {
  bigIntStringSchema,
  coinTypeVersionSchema,
  inventoryBalanceSchema,
  inventoryItemTypeSchema,
  isoDateTimeSchema,
  priceQuoteAmountRialSchema,
  priceQuoteSchema as sharedPriceQuoteSchema,
  jewelryCashSaleSchema as sharedJewelryCashSaleSchema,
  jewelryCreditSaleSchema as sharedJewelryCreditSaleSchema,
  coinSaleSchema as sharedCoinSaleSchema,
  rialSettlementSchema as sharedRialSettlementSchema,
  goldSettlementSchema as sharedGoldSettlementSchema,
  type Party,
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
  partyStatusSchema,
  partySchema,
  partyListSchema,
  partyListQuerySchema,
  createPartySchema,
  updatePartySchema,
  partyBalancesSchema,
  partyBalancesQuerySchema,
  partyStatementSchema,
  partyStatementQuerySchema,
  partyStatementSourceTypeSchema,
  type Party,
  type PartyList,
  type PartyListQuery,
  type CreatePartyInput,
  type UpdatePartyInput,
  type PartyBalances,
  type PartyBalancesQuery,
  type PartyStatement,
  type PartyStatementQuery,
  type PartyStatementSourceType,
  loginSchema,
  sessionResponseSchema,
  refreshSchema,
  roleCodeSchema,
  priceQuoteTypeSchema,
  priceQuoteSourceSchema,
  priceQuoteAmountRialSchema,
  createManualPriceQuoteSchema,
  jewelryWageTypeSchema,
  karatSchema,
  jewelryItemVersionSchema,
  jewelryItemListSchema,
  jewelryItemQuerySchema,
  createJewelryItemSchema,
  updateJewelryItemSchema,
  coinMintTypeSchema,
  coinTypeVersionSchema,
  inventoryItemTypeSchema,
  inventoryBalanceSchema,
  openingBalanceLineSchema,
  createOpeningBalanceSchema,
  openingBalanceSchema,
  dashboardSchema,
  dashboardQuerySchema,
  reportingDisplayUnitSchema,
  createJewelryCashSaleSchema,
  createJewelryCreditSaleSchema,
  createCoinSaleSchema,
  createRialSettlementSchema,
  createGoldSettlementSchema,
  salesInvoiceVersionHistorySchema,
  type CreateJewelryCashSaleInput,
  type CreateJewelryCreditSaleInput,
  type CreateCoinSaleInput,
  type CreateRialSettlementInput,
  type CreateGoldSettlementInput,
  type SalesInvoiceVersionHistory,
  type LoginInput,
  type SessionResponse,
  type RefreshInput,
  type RoleCode,
  type PriceQuoteType,
  type CreateManualPriceQuoteInput,
  type JewelryWageType,
  type JewelryItemVersion,
  type JewelryItemList,
  type JewelryItemQuery,
  type CreateJewelryItemInput,
  type UpdateJewelryItemInput,
  type CoinMintType,
  type CoinTypeVersion,
  type InventoryItemType,
  type InventoryBalance,
  type OpeningBalanceLine,
  type CreateOpeningBalanceInput,
  type OpeningBalance,
  type Dashboard,
  type DashboardQuery,
  type ReportingDisplayUnit,
} from '@gold/contracts';

/** `@gold/contracts` این‌ها را جدا export نمی‌کند؛ اینجا از خودِ `Party` گرفته می‌شوند. */
export type PartyType = Party['type'];
export type PartyStatus = Party['status'];

/**
 * پاسخ خام هر دو endpoint یک آرایه‌ی ساده است، نه `{items, total}` — بدون
 * پوشش صفحه‌بندی، چون تعداد ردیف کم است (بخش ۴ فرم فهرست موجودی سکه).
 * خودِ `inventoryBalanceSchema` واقعی و از BE-028 است (`GET
 * /inventory/balances`)؛ فقط پوشش آرایه‌اش اینجاست چون `packages/contracts`
 * برایش envelope جدا تعریف نکرده.
 */
export const inventoryBalanceListSchema = z.array(inventoryBalanceSchema);
export type InventoryBalanceList = z.infer<typeof inventoryBalanceListSchema>;

/**
 * ⚠️ بدون معادل بک‌اندی هنوز — `coinTypeVersionSchema` واقعی است (BE-020)
 * ولی `apps/api` فعلاً هیچ controller‌ای برای فهرست‌کردن آن ندارد
 * (`InventoryModule.controllers` فقط `JewelryItemsController` و
 * `OpeningBalancesController` دارد). مسیر `/inventory/coin-types` اینجا
 * فقط با MSW پاسخ داده می‌شود، نه سرور واقعی — همان الگوی
 * `itemSchema`/`profitReportSchema` پایین‌تر. وقتی endpoint واقعی اضافه
 * شد، این فقط یک تغییر مسیر است، نه تغییر schema.
 */
export const coinTypeListSchema = z.array(coinTypeVersionSchema);
export type CoinTypeList = z.infer<typeof coinTypeListSchema>;

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

/* ── GET /api/inventory/movements/recent — FE-040 ────────────── */

/**
 * ⚠️ بدون معادل بک‌اندی هنوز. `inventoryMovementSchema` واقعی
 * (`@gold/contracts`) با `itemId` خام (uuid یا null) کار می‌کند —
 * درست برای دفتر کل، ولی برای نمایش «آخرین حرکات» به تنهایی کافی
 * نیست: کاربر باید بی‌واسطه بفهمد کدام کالا، نه یک uuid. این view model
 * محلی، دقیقاً مثل `transactionSchema` بالا، برچسب کالا را از قبل حل‌شده
 * حمل می‌کند — همان تجمیع UI-محور، نه یک DTO سیمی بک‌اندی.
 *
 * برخلاف کامنت‌های `profitReportSchema`/`transactionSchema` بالا («دفتر
 * کل اسکلت خالی است»)، این دیگر درست نیست — دفتر کل کامل است
 * (Milestone 7 تا 13 انجام شده). فقط **فهرست‌کردن** حرکات موجودی هیچ
 * controller‌ای ندارد؛ `InventoryMovementsService` فقط `.balance()` و
 * `.balances()` (تجمیع) را expose می‌کند، نه رکوردهای خام.
 */
export const recentInventoryMovementSourceSchema = z.enum([
  'OPENING_BALANCE',
  'SALE',
  'PURCHASE',
  'CORRECTION',
]);
export type RecentInventoryMovementSource = z.infer<typeof recentInventoryMovementSourceSchema>;

export const recentInventoryMovementSchema = z.object({
  id: z.string(),
  sourceType: recentInventoryMovementSourceSchema,
  itemType: inventoryItemTypeSchema,
  /** برچسب حل‌شده برای نمایش — «تمام بهار آزادی»، «دستبند ۱۸ عیار»، یا «آبشده» */
  itemLabel: z.string(),
  /** رشته‌ی صحیح علامت‌دار — واحدش به itemType بستگی دارد، دقیقاً مثل inventoryQuantitySchema واقعی */
  quantity: bigIntStringSchema,
  occurredAt: isoDateTimeSchema,
});
export type RecentInventoryMovement = z.infer<typeof recentInventoryMovementSchema>;

export const recentInventoryMovementListSchema = z.array(recentInventoryMovementSchema);

/* ══════════════ بازگشت به @gold/contracts — فروش ══════════════ */

/* ── POST /api/sales/invoices/jewelry — FE-045/BE-041 ───────── */

/**
 * پاسخ ثبت فروش نقدی زیورآلات.
 *
 * آینه‌ی `jewelryCashSaleSchema` واقعی (`@gold/contracts`)، فقط با
 * `payableRial` تبدیل‌شده به `bigint` — همان یک قدمی که
 * `priceQuoteSchema` بالاتر هم برمی‌دارد. قرارداد پایه از بک‌اند می‌آید و
 * اینجا دوباره تعریف نمی‌شود.
 *
 * این مبلغ **تنها مبلغ معتبر** فاکتور است: سرور خودش از روی نسخه‌ی کالا و
 * `quoteId` قیمت می‌زند (`SalesPricingService.priceJewelryInTransaction`)
 * و پیش‌نمایش کلاینت هیچ سهمی در آن ندارد. هرجا این دو نخوانند، عدد سرور
 * درست است و اختلاف باید به کاربر نشان داده شود، نه پنهان شود.
 *
 * ⚠️ mock قدیمی `POST /api/invoices` (آرایه‌ای از خطوط + مظنه‌ی خام) که
 * جای همین قرارداد را نگه داشته بود، در همین تسک حذف شد — هیچ صفحه‌ای
 * صدایش نمی‌زد و شکلش هم دیگر شکل بک‌اند نبود.
 */
export const jewelryCashSaleSchema = sharedJewelryCashSaleSchema.extend({
  payableRial: bigintString,
});
export type JewelryCashSale = z.infer<typeof jewelryCashSaleSchema>;

/* ── POST /api/sales/invoices/jewelry/credit — FE-047/BE-042 ─── */

/**
 * پاسخ ثبت فروش نسیه. همان شکل نقدی، به‌اضافه‌ی `receivableRial` —
 * **مانده‌ی این فاکتور، محاسبه‌شده‌ی سرور**، نه تفریق کلاینت.
 *
 * چرا مهم است: مبلغ نهایی را سرور می‌زند (نسخه‌ی کالا + `quoteId`)، پس
 * `payable − paid` سمت کلاینت با عددی حساب می‌شود که ممکن است مبلغ واقعی
 * سند نباشد. مانده‌ای که به مشتری نشان داده می‌شود باید همانی باشد که در
 * حساب او نشسته.
 */
export const jewelryCreditSaleSchema = sharedJewelryCreditSaleSchema.extend({
  payableRial: bigintString,
  receivableRial: bigintString,
});
export type JewelryCreditSale = z.infer<typeof jewelryCreditSaleSchema>;

/* ── POST /api/sales/invoices/coins — FE-048/BE-043 ─────────── */

/**
 * پاسخ ثبت فروش سکه. برخلاف زیورآلات یک endpoint واحد است، نه نقدی/نسیه‌ی
 * جدا — چون `CoinSalesService` خودش `paidRial` را همیشه می‌گیرد و
 * `receivableRial` را همیشه برمی‌گرداند (صفر یعنی نقدی کامل).
 *
 * `intrinsicValueRial`/`bubbleRial` مقدار **یک سکه** است، نه کل معامله —
 * دقیقاً همان چیزی که `SalesPricingService.priceCoinInTransaction` واقعی
 * می‌سازد (`intrinsicValue`/`bubble` روی یک `CoinType`، نه ضرب‌شده در
 * تعداد). `bubbleRial` فقط برای سکه‌ی بانک مرکزی مقدار دارد — قانون حباب.
 */
export const coinSaleSchema = sharedCoinSaleSchema.extend({
  payableRial: bigintString,
  receivableRial: bigintString,
  intrinsicValueRial: bigintString,
  bubbleRial: bigIntStringSchema.nullable().transform((value) => (value === null ? null : BigInt(value))),
});
export type CoinSale = z.infer<typeof coinSaleSchema>;

/* ── POST /api/parties/:partyId/settlements/rial — FE-051/BE-045 ─── */

/**
 * پاسخ ثبت پرداخت ریالی روی مانده‌ی شخص. تک‌بعدی است — بدون تبدیل واحد،
 * بدون اثر موجودی (`RialSettlementsService` واقعی). `amountRial` همان
 * مبلغی است که ارسال شد؛ سرور آن را echo می‌کند چون خودِ endpoint چیزی
 * محاسبه‌شده‌ای برنمی‌گرداند (برخلاف فروش، اینجا قیمتی در کار نیست).
 */
export const rialSettlementSchema = sharedRialSettlementSchema.extend({
  amountRial: bigintString,
});
export type RialSettlement = z.infer<typeof rialSettlementSchema>;

/* ── POST /api/parties/:partyId/settlements/gold — FE-052/BE-046 ─── */

/**
 * پاسخ ثبت دریافت طلا برای تسویه. `goldRatePerGramRial` همان `rate1000`ی
 * است که سرور از `quoteId` قفل کرده (`gramRate1000` واقعی) — دقیقاً همان
 * نرخی که برای `AmountDisplay`/`dualFromRial` لازم است، پس این پاسخ خودش
 * کافی است و به یک fetch مظنه‌ی جداگانه بعد از ثبت نیاز نیست.
 */
export const goldSettlementSchema = sharedGoldSettlementSchema.extend({
  pureWeightMg: bigintString,
  settledRial: bigintString,
  goldRatePerGramRial: bigintString,
});
export type GoldSettlement = z.infer<typeof goldSettlementSchema>;
