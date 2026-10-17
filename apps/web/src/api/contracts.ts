import { z } from 'zod';
import {
  bigIntStringSchema,
  uuidSchema,
  coinTypeVersionSchema,
  inventoryBalanceSchema,
  priceQuoteAmountRialSchema,
  priceQuoteSchema as sharedPriceQuoteSchema,
  priceFeedStatusSchema as sharedPriceFeedStatusSchema,
  priceFeedFailureSchema,
  jewelryCashSaleSchema as sharedJewelryCashSaleSchema,
  jewelryCreditSaleSchema as sharedJewelryCreditSaleSchema,
  coinSaleSchema as sharedCoinSaleSchema,
  rialSettlementSchema as sharedRialSettlementSchema,
  goldSettlementSchema as sharedGoldSettlementSchema,
  coinSettlementSchema as sharedCoinSettlementSchema,
  recentTransactionSchema as sharedRecentTransactionSchema,
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
 * ۲. **لایه‌ی تبدیل محلی** — همان قرارداد مشترک، فقط با مبالغ رشته‌ای
 *    تبدیل‌شده به `bigint` برای `core-calc`/JSX (`.extend` روی schema ِ
 *    مشترک، نه تعریف دوباره). از FE-106b هیچ View model ِ بی‌endpointی نمانده:
 *    هر مسیری که فرانت صدا می‌زند در سرور هست (آزمون قرارداد mock این را می‌سنجد).
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
  coinTypeCatalogSchema,
  coinTypeHistorySchema,
  createCoinTypeSchema,
  createCoinTypeVersionSchema,
  inventoryItemTypeSchema,
  inventoryBalanceSchema,
  openingBalanceLineSchema,
  createOpeningBalanceSchema,
  openingBalanceSchema,
  dashboardSchema,
  dashboardQuerySchema,
  generalSettingKeySchema,
  generalSettingsSchema,
  generalSettingSchema,
  updateGeneralSettingSchema,
  generalSettingValueError,
  roundingPolicySchema,
  type GeneralSetting,
  type GeneralSettingKey,
  type GeneralSettings,
  type UpdateGeneralSettingInput,
  reportingDisplayUnitSchema,
  reportingSortDirectionSchema,
  partyReportDirectionSchema,
  partyBalanceReportSchema,
  partyBalanceReportQuerySchema,
  // گزارش سود واقعی BE-060 (FE-075). نام جدا تا با «گزارش» ِ دیگر قراردادها قاطی نشود؛ از
  // FE-106a کارت سود صفحه‌ی اصلی هم همین را می‌خواند (view model ِ فقط‌MSW ِ قبلی حذف شد).
  profitReportSchema as ledgerProfitReportSchema,
  profitReportQuerySchema as ledgerProfitReportQuerySchema,
  type ProfitReport as LedgerProfitReport,
  type ProfitReportQuery as LedgerProfitReportQuery,
  type PartyBalanceReport,
  type PartyBalanceReportQuery,
  type PartyReportDirection,
  createJewelryCashSaleSchema,
  createJewelryCreditSaleSchema,
  createCoinSaleSchema,
  createRialSettlementSchema,
  createGoldSettlementSchema,
  createCoinSettlementSchema,
  createMixedSettlementSchema,
  salesInvoiceVersionHistorySchema,
  type CreateJewelryCashSaleInput,
  type CreateJewelryCreditSaleInput,
  type CreateCoinSaleInput,
  type CreateRialSettlementInput,
  type CreateGoldSettlementInput,
  type CreateCoinSettlementInput,
  type CreateMixedSettlementInput,
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
  type CoinTypeCatalog,
  type CoinTypeHistory,
  type CreateCoinTypeInput,
  type CreateCoinTypeVersionInput,
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
 * پاسخ `GET /inventory/coin-types` — نسخه‌ی مؤثر همین لحظه‌ی هر نوع سکه،
 * فعال و غیرفعال (`CoinTypesController`، FE-081؛ پیش از آن فقط MSW).
 * پوشش آرایه اینجاست چون `packages/contracts` برایش envelope جدا ندارد.
 */
export const coinTypeListSchema = z.array(coinTypeVersionSchema);
export type CoinTypeList = z.infer<typeof coinTypeListSchema>;

/* ══════════════ فهرست و جزئیات فاکتور فروش — FE-106b ══════════════ */

/**
 * `GET /sales/invoices` و `GET /sales/invoices/:invoiceId/detail` — پیش‌تر View model
 * محلی FE-064/FE-065 که فقط MSW پاسخش را می‌داد؛ FE-106b همین قرارداد را بدون
 * تغییر شکل به `packages/contracts` برد و `SalesInvoiceReadsController` آن را
 * از snapshot ِ خود سند می‌سازد. نرخ گرم ۱۰۰۰ ِ هر ردیف قفل‌شده‌ی لحظه‌ی فروش است.
 */
export {
  salesInvoiceStatusSchema,
  salesInvoiceListQuerySchema,
  salesInvoiceListItemSchema,
  salesInvoiceListSchema,
  salesInvoiceDetailSchema,
  type SalesInvoiceStatus,
  type SalesInvoiceListQuery,
  type SalesInvoiceListItem,
  type SalesInvoiceList,
  type SalesInvoiceDetail,
} from '@gold/contracts';

/**
 * رشته‌ی ارقام صحیح روی سیم → `bigint` در برنامه.
 * قاعده‌ی اعتبارسنجی (چه رشته‌ای مجاز است) از `@gold/contracts` می‌آید —
 * همان چیزی که بک‌اند هم بررسی می‌کند؛ تبدیل به `bigint` فقط اینجا لازم
 * است چون مصرف‌کننده‌ی نهایی (`core-calc`, JSX) به مقدار عددی نیاز دارد،
 * نه رشته.
 */
const bigintString = bigIntStringSchema.transform((value) => BigInt(value));

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

/* ── GET /api/pricing/feed/status و POST .../refresh — FE-082 ──── */

/**
 * آینه‌ی `priceFeedStatusSchema` و `priceFeedRefreshResultSchema` واقعی، با
 * همان `priceQuoteSchema` بالا (مبلغ `bigint`). منبع فعال = منبع `activeQuote`،
 * یعنی آخرین مظنه‌ی ذخیره‌شده — همانی که فروش با `quoteId`اش قیمت می‌خورد.
 */
export const priceFeedStatusSchema = sharedPriceFeedStatusSchema.extend({
  activeQuote: priceQuoteSchema.nullable(),
  latestFeedQuote: priceQuoteSchema.nullable(),
  latestManualQuote: priceQuoteSchema.nullable(),
});
export type PriceFeedStatus = z.infer<typeof priceFeedStatusSchema>;

export const priceFeedRefreshResultSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('FEED'), failure: z.null(), quote: priceQuoteSchema }),
  z.object({ outcome: z.literal('FALLBACK'), failure: priceFeedFailureSchema, quote: priceQuoteSchema }),
  z.object({ outcome: z.literal('UNAVAILABLE'), failure: priceFeedFailureSchema, quote: z.null() }),
]);
export type PriceFeedRefreshResult = z.infer<typeof priceFeedRefreshResultSchema>;
export type PriceFeedFailure = z.infer<typeof priceFeedFailureSchema>;

/* ── GET /api/transactions/recent — FE-106b ─────────────────── */

/**
 * آینه‌ی `recentTransactionSchema` ِ مشترک (`RecentTransactionsController`)، فقط با
 * مبلغ دومقیاسه‌ی تبدیل‌شده به `bigint` برای `AmountDisplay` — همان الگوی `priceQuoteSchema`.
 * سرور ریال، معادل طلا و نرخ قفل‌شده‌ی هر سند را می‌دهد؛ اینجا چیزی محاسبه نمی‌شود.
 */
export {
  recentTransactionKindSchema as transactionKindSchema,
  type RecentTransactionKind as TransactionKind,
} from '@gold/contracts';

export const transactionSchema = sharedRecentTransactionSchema.extend({
  amount: dualAmountSchema,
});
export type Transaction = z.infer<typeof transactionSchema>;

export const transactionListSchema = z.object({
  items: z.array(transactionSchema),
});

/* ── GET /api/inventory/movements/recent — FE-040/FE-106b ────── */

/**
 * `RecentInventoryMovementsController` — برچسب کالا سمت سرور حل می‌شود (عنوان آخرین
 * نسخه‌ی زیورآلات/نوع سکه، یا «آبشده»). منبع حرکت همان enum ِ کامل دیتابیس است.
 */
export {
  recentInventoryMovementSchema,
  recentInventoryMovementListSchema,
  inventoryMovementSourceTypeSchema as recentInventoryMovementSourceSchema,
  type RecentInventoryMovement,
  type InventoryMovementSourceType as RecentInventoryMovementSource,
} from '@gold/contracts';

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

/* ── POST /api/parties/:partyId/settlements/coins — FE-053/BE-047 ─── */

/**
 * پاسخ ثبت دریافت سکه برای تسویه. `intrinsicValueRial`/`bubbleRial` مقدار
 * **یک سکه** است، دقیقاً مثل پاسخ فروش سکه (`coinSaleSchema`) — سرور هم
 * از همان `intrinsicValue`/`bubble` تک‌واحدی `core-calc` می‌سازدشان.
 */
export const coinSettlementSchema = sharedCoinSettlementSchema.extend({
  settledRial: bigintString,
  intrinsicValueRial: bigintString,
  bubbleRial: bigIntStringSchema.nullable().transform((value) => (value === null ? null : BigInt(value))),
});
export type CoinSettlement = z.infer<typeof coinSettlementSchema>;

/* ── POST /api/parties/:partyId/settlements/mixed — FE-054/BE-048 ─── */

/**
 * پاسخ ثبت تسویه‌ی ترکیبی. `mixedSettlementResultLineSchema` واقعی یک
 * discriminated union است؛ `.extend()` مستقیم روی union ممکن نیست، پس هر
 * چهار شکل اینجا جدا با `bigintString` بازسازی می‌شوند — نه یک تعریف
 * جدید، فقط همان قرارداد با تبدیل رشته→`bigint`.
 */
const mixedRialSettlementResultLine = z.object({ type: z.literal('RIAL'), settledRial: bigintString });
const mixedGoldSettlementResultLine = z.object({
  type: z.literal('GOLD'),
  inventoryMovementId: uuidSchema,
  pureWeightMg: bigintString,
  settledRial: bigintString,
  goldRatePerGramRial: bigintString,
});
const mixedCoinSettlementResultLine = z.object({
  type: z.literal('COIN'),
  inventoryMovementId: uuidSchema,
  coinTypeId: uuidSchema,
  count: z.number().int().positive(),
  settledRial: bigintString,
  intrinsicValueRial: bigintString,
  bubbleRial: bigIntStringSchema.nullable().transform((value) => (value === null ? null : BigInt(value))),
});
const mixedCreditSettlementResultLine = z.object({ type: z.literal('CREDIT'), settledRial: bigintString });

export const mixedSettlementResultLineSchema = z.discriminatedUnion('type', [
  mixedRialSettlementResultLine,
  mixedGoldSettlementResultLine,
  mixedCoinSettlementResultLine,
  mixedCreditSettlementResultLine,
]);

export const mixedSettlementSchema = z.object({
  settlementId: uuidSchema,
  ledgerTransactionId: uuidSchema,
  totalSettledRial: bigintString,
  lines: z.array(mixedSettlementResultLineSchema).min(1),
});

export type MixedSettlementResultLine = z.infer<typeof mixedSettlementResultLineSchema>;
export type MixedSettlement = z.infer<typeof mixedSettlementSchema>;
