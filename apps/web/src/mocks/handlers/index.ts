import {
  bubble,
  calculateB2cBuybackDifference,
  calculateSecondHandGoldPurchase,
  coinPositionValue,
  DEFAULT_ROUNDING_UNIT,
  gramRate1000,
  grossMg,
  grossUg,
  intrinsicValue,
  invoiceNumberLabel,
  karat,
  RATE_DIVISOR,
  rial,
  searchKey,
  toPureMg,
  valueOfPure,
} from '@gold/core-calc';
import type { CoinType } from '@gold/core-calc';
import {
  amendSalesInvoiceSchema,
  createB2cBuybackSchema,
  previewB2cBuybackSchema,
  createSecondHandCoinPurchaseSchema,
  createSecondHandGoldPurchaseSchema,
  createCoinTypeSchema,
  createCoinTypeVersionSchema,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  priceQuoteHistoryQuerySchema,
  profitReportQuerySchema,
  updateGeneralSettingSchema,
} from '@gold/contracts';
import type { CoinTypeHistory, CoinTypeVersion, SalesInvoiceAmendmentHistory } from '@gold/contracts';
import { HttpResponse, http, delay } from 'msw';
import type {
  JewelryItemVersion,
  Party,
  SalesInvoiceDetail,
  SalesInvoiceListItem,
  SalesInvoiceVersionHistory,
} from '@/api/contracts';
import {
  COIN_BALANCE_ROWS,
  COIN_TYPE_VERSIONS,
  dashboardFor,
  FETCHED_AT,
  JEWELRY_BALANCE_ROWS,
  jewelryItemVersionRecords,
  ledgerProfitReportFor,
  MAZNEH_RIAL,
  MOCK_INVOICE_PERIOD,
  MOCK_PROFIT_RATE_BPS,
  MOCK_TAX_RATE_BPS,
  PARTY_RIAL_BALANCE,
  partyBalanceReportFor,
  partyBalancesFor,
  partyMgById,
  partyRecords,
  partyStatementEntriesFor,
  priceJewelryFromVersion,
  RECENT_INVENTORY_MOVEMENTS,
  recentTransactions,
  salesInvoiceDetailRecords,
  salesInvoiceRecords,
  salesInvoiceVersionRecords,
} from './fixtures';
import { commitIdempotentRequest, contractGate } from './contract-gate';
import { mockError, mockMissingIdempotencyKey, mockValidationError } from './errors';

/**
 * پاسخ‌دهنده‌های ساختگی.
 *
 * این‌ها **قرارداد نهایی REST** را پیاده می‌کنند، نه یک میان‌بر موقت.
 * وقتی بک‌اند آمد، فقط `worker.start()` در `main.tsx` خاموش می‌شود و
 * هیچ خطی از کد صفحات عوض نمی‌شود.
 *
 * تأخیر عمدی ۲۵۰ms روی خواندن‌ها: بدون آن، حالت `loading` هیچ‌وقت دیده
 * نمی‌شود و Skeletonها عملاً تست نمی‌شوند. شبکه‌ی پاساژ بازار قطعاً
 * کندتر از این است.
 */

const READ_DELAY_MS = 250;
const WRITE_DELAY_MS = 400;

/** جست‌وجوی فارسی‌آگاه — «علي» باید «علی» را پیدا کند */
function matchesQuery(haystack: string, query: string | null): boolean {
  if (!query) return true;
  return searchKey(haystack).includes(searchKey(query));
}

/** آینه‌ی `MOBILE_SEPARATOR` واقعی (`parties.service.ts`، BE-024) — «۰۹۱۲-۱۲۳» باید «09121234567» را پیدا کند */
const MOBILE_SEPARATOR = /[\s\-()[\]{}./\\]/gu;

function matchesMobile(mobile: string | null, query: string | null): boolean {
  if (!query) return true;
  if (!mobile) return false;
  return searchKey(mobile).replace(MOBILE_SEPARATOR, '').includes(searchKey(query).replace(MOBILE_SEPARATOR, ''));
}

/**
 * فهرست قابل‌جهش اشخاص — `POST /parties` (FE-032) رکورد تازه را اینجا
 * اضافه می‌کند تا `GET /parties` بلافاصله بعد از invalidate آن را ببیند،
 * همان الگوی `maznehQuoteHistory` برای مظنه.
 */
let partyList: Party[] = [...partyRecords];

/**
 * فهرست قابل‌جهش کالای زیورآلات — `POST`/`PATCH` (FE-036) اینجا اضافه
 * یا جایگزین می‌کنند تا `GET` بلافاصله بعد از invalidate تازه را ببیند.
 * هر ردیف همیشه نسخه‌ی **باز** همان کالاست؛ این mock تاریخچه‌ی نسخه‌های
 * قدیمی را نگه نمی‌دارد چون هیچ صفحه‌ای امروز آن را نمی‌خواهد.
 */
let jewelryItemList: JewelryItemVersion[] = [...jewelryItemVersionRecords];
let jewelryItemVersionCounter = jewelryItemVersionRecords.length;

/**
 * نسخه‌ی کالاهای فروخته‌شده — فروش آن‌ها را از `jewelryItemList` بیرون می‌برد، اما اصلاح فاکتور
 * و خرید مجدد B2C (FE-093) هنوز همان نسخه را برای بازسازی قیمت تاریخی لازم دارند.
 */
const soldJewelryItems = new Map<string, JewelryItemVersion>();

function findJewelryVersion(jewelryItemId: string): JewelryItemVersion | undefined {
  return (
    jewelryItemList.find((item) => item.jewelryItemId === jewelryItemId) ??
    soldJewelryItems.get(jewelryItemId) ??
    jewelryItemVersionRecords.find((item) => item.jewelryItemId === jewelryItemId)
  );
}

let invoiceCounter = 122;

/**
 * فاکتورهای ثبت‌شده در همین نشست — کلید `invoiceId`.
 *
 * `GET /sales/invoices/:id/versions` (FE-046) باید **همان** چیزی را
 * برگرداند که `POST` ثبت کرده، نه یک fixture ثابت؛ وگرنه رسید چیزی نشان
 * می‌دهد که هیچ‌وقت ثبت نشده و کل قاعده‌ی «رسید = پاسخ سرور» در توسعه
 * ساختگی می‌شود.
 */
const salesInvoiceVersions = new Map<string, SalesInvoiceVersionHistory>(
  salesInvoiceVersionRecords.map((history) => [history.invoiceId, history]),
);

function historyDifference(before: string | null, after: string | null): string | null {
  return before === null || after === null ? null : (BigInt(after) - BigInt(before)).toString();
}
const salesInvoiceDetails = new Map<string, SalesInvoiceDetail>(
  salesInvoiceDetailRecords.map((detail) => [detail.id, detail]),
);
let salesInvoiceList: SalesInvoiceListItem[] = [...salesInvoiceRecords];

/** فاکتور تازه باید بلافاصله در GET فهرست دیده شود، درست مثل سرور واقعی. */
function recordSalesInvoice(input: {
  readonly id: string;
  readonly invoiceNumber: number;
  readonly invoicePeriod: string;
  readonly partyId: string;
  readonly payableRial: string;
  readonly quoteAmountRial: string;
  readonly occurredAt: string;
}): void {
  const party = partyList.find((candidate) => candidate.id === input.partyId);
  salesInvoiceList = [
    {
      id: input.id,
      invoiceNumber: input.invoiceNumber,
      invoicePeriod: input.invoicePeriod,
      status: 'FINALIZED',
      currentVersion: 1,
      party: {
        id: input.partyId,
        displayName: party?.displayName ?? 'شخص نامشخص',
      },
      payableRial: input.payableRial,
      goldRatePerGramRial: gramRate1000(BigInt(input.quoteAmountRial)).toString(),
      occurredAt: input.occurredAt,
    },
    ...salesInvoiceList,
  ];
}

/** حافظه‌ی کلیدهای idempotency — تکرار همان کلید همان پاسخ را می‌دهد */
/**
 * پاسخ‌های ذخیره‌شده‌ی هر Idempotency-Key. بعضی handlerها پیشوند می‌گذارند (`purchase:<key>`)؛
 * کلید واقعی آخرین بخش است. ذخیره‌ی پاسخ موفق اثر انگشت درخواست را در دروازه‌ی قرارداد قطعی
 * می‌کند، تا همان کلید با بدنه‌ی دیگر مثل سرور `409` بگیرد (M-22، #33).
 */
class IdempotencyCache extends Map<string, unknown> {
  override set(cacheKey: string, value: unknown): this {
    commitIdempotentRequest(cacheKey.split(':').at(-1) ?? cacheKey);
    return super.set(cacheKey, value);
  }
}

const idempotencyCache = new IdempotencyCache();

/**
 * خریدهای دست‌دومی که در همین نشست mock ثبت شده‌اند — فقط برای اینکه
 * `GET /purchase/second-hand/:id/pdf` مثل سرور، سند ناشناخته را ۴۰۴ بدهد.
 */
const mockSecondHandPurchaseIds = new Set<string>();

/**
 * تنظیمات عمومی mock (FE-080) — مقدارها همان seed واقعی `INITIAL_TENANT_SETTINGS`.
 * هر POST یک نسخه‌ی تازه می‌سازد؛ نسخه‌ی قبلی overwrite نمی‌شود.
 */
const mockGeneralSettings = new Map<string, { value: string; version: number; validFrom: string; createdBy: string | null }>([
  ['purchase.second_hand_default_karat', { value: '740', version: 1, validFrom: '2026-07-01T00:00:00.000Z', createdBy: null }],
  ['pricing.rial_rounding_unit', { value: '1000', version: 1, validFrom: '2026-07-01T00:00:00.000Z', createdBy: null }],
  ['pricing.rounding_policy', { value: 'HALF_UP', version: 1, validFrom: '2026-07-01T00:00:00.000Z', createdBy: null }],
  ['reporting.default_display_karat', { value: '750', version: 1, validFrom: '2026-07-01T00:00:00.000Z', createdBy: null }],
  ['sales.invoice_correction_window_minutes', { value: '30', version: 1, validFrom: '2026-07-01T00:00:00.000Z', createdBy: null }],
  ['sales.manager_approval_variance_rial', { value: '0', version: 1, validFrom: '2026-07-01T00:00:00.000Z', createdBy: null }],
]);

/**
 * انواع سکه‌ی mock با تاریخچه (FE-081) — از همان `COIN_TYPE_VERSIONS`. هر POST
 * نسخه‌ی تازه‌ای از «اکنون» می‌سازد و نسخه‌ی قبلی را با `validTo` می‌بندد؛
 * هیچ نسخه‌ای overwrite نمی‌شود. `GET /inventory/coin-types` نسخه‌ی جاری را
 * از همین‌جا می‌خواند تا نوع تازه در فرم‌های dev هم دیده شود.
 */
const mockCoinTypeHistory: Array<{ coinTypeId: string; code: string; versions: CoinTypeVersion[] }> =
  COIN_TYPE_VERSIONS.map((version) => ({ coinTypeId: version.coinTypeId, code: version.code, versions: [version] }));

function mockCoinTypeVersion(
  coinTypeId: string,
  code: string,
  version: number,
  spec: { title: string; mintType: CoinTypeVersion['mintType']; grossWeightUg: string; karat: number; active: boolean },
): CoinTypeVersion {
  const shared = {
    id: crypto.randomUUID(),
    coinTypeId,
    code,
    title: spec.title,
    grossWeightUg: spec.grossWeightUg,
    karat: spec.karat,
    validFrom: new Date().toISOString(),
    validTo: null,
    version,
    active: spec.active,
  };
  // isCentralBankMinted مثل سرور از نوع ضرب مشتق می‌شود، نه از ورودی.
  return spec.mintType === 'CENTRAL_BANK'
    ? { ...shared, mintType: 'CENTRAL_BANK', isCentralBankMinted: true }
    : { ...shared, mintType: spec.mintType, isCentralBankMinted: false };
}


/**
 * تاریخچه‌ی مظنه‌ی MAZNEH — نزولی بر اساس `observedAt` (همان ترتیب
 * `list()` واقعی، `price-quotes.service.ts`). عنصر ۰ = «جاری».
 *
 * قابل جهش با `POST /pricing/quotes/manual` (FE-030): هر ثبت موفق در
 * ابتدای همین آرایه اضافه می‌شود تا invalidation واقعی قابل‌مشاهده باشد —
 * هم `GET .../latest` هم `GET .../quotes` (فهرست، FE-031) مقدار تازه را
 * فوراً ببینند، نه همیشه fixture اولیه را.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
let maznehQuoteHistory = [
  {
    // priceQuoteSchema واقعی id/createdBy را با uuidSchema اعتبارسنجی می‌کند — رشته‌ی دلخواه رد می‌شود
    id: 'c1000000-0000-4000-8000-000000000001',
    quoteType: 'MAZNEH' as const,
    amountRial: MAZNEH_RIAL.toString(),
    source: 'MANUAL' as const,
    observedAt: FETCHED_AT.toISOString(),
    createdBy: 'c1000000-0000-4000-8000-000000000002',
    createdAt: FETCHED_AT.toISOString(),
  },
  {
    id: 'c1000000-0000-4000-8000-000000000003',
    quoteType: 'MAZNEH' as const,
    amountRial: (MAZNEH_RIAL - 3_500_000n).toString(),
    source: 'FEED' as const,
    observedAt: new Date(FETCHED_AT.getTime() - 2 * DAY_MS).toISOString(),
    createdBy: null,
    createdAt: new Date(FETCHED_AT.getTime() - 2 * DAY_MS).toISOString(),
  },
  {
    id: 'c1000000-0000-4000-8000-000000000004',
    quoteType: 'MAZNEH' as const,
    amountRial: (MAZNEH_RIAL - 9_000_000n).toString(),
    source: 'MANUAL' as const,
    observedAt: new Date(FETCHED_AT.getTime() - 6 * DAY_MS).toISOString(),
    createdBy: 'c1000000-0000-4000-8000-000000000002',
    createdAt: new Date(FETCHED_AT.getTime() - 6 * DAY_MS).toISOString(),
  },
  {
    id: 'c1000000-0000-4000-8000-000000000005',
    quoteType: 'MAZNEH' as const,
    amountRial: (MAZNEH_RIAL - 14_000_000n).toString(),
    source: 'FEED' as const,
    observedAt: new Date(FETCHED_AT.getTime() - 13 * DAY_MS).toISOString(),
    createdBy: null,
    createdAt: new Date(FETCHED_AT.getTime() - 13 * DAY_MS).toISOString(),
  },
];

/**
 * اعتبار آزمایشی FE-026/FE-028 — فقط برای توسعه، هرگز در production
 * استفاده نمی‌شود. دو حساب با نقش متفاوت تا رفتار نقش‌محور (FE-028) هم
 * قابل آزمون دستی باشد، نه فقط با تست خودکار.
 */
const DEMO_PASSWORD = 'password123';
const DEMO_TENANT_SLUG = 'demo';

const DEMO_USERS = {
  'owner@example.com': { id: 'usr-owner-1', displayName: 'مدیر فروشگاه', role: 'OWNER' as const },
  'cashier@example.com': { id: 'usr-cashier-1', displayName: 'صندوق‌دار', role: 'CASHIER' as const },
};

/**
 * توکن‌های تمدید معتبر — شبیه‌سازی چرخش توکن واقعی BE-011 (auth.service.ts).
 * هر تمدید موفق، توکن ورودی را از این مجموعه حذف و توکن تازه را اضافه
 * می‌کند؛ استفاده‌ی دوباره از توکن قدیمی رد می‌شود، همان‌طور که سرور
 * واقعی رد می‌کند. هر توکن به ایمیلی که واردش کرده نگاشت می‌شود تا
 * تمدید هم نقش درست همان کاربر را برگرداند.
 */
const validRefreshTokens = new Map<string, keyof typeof DEMO_USERS>();

function issueSession(key: string, email: keyof typeof DEMO_USERS) {
  const accessToken = `mock-access-${key}`;
  const refreshToken = `mock-refresh-${key}`;
  validRefreshTokens.set(refreshToken, email);
  const demoUser = DEMO_USERS[email];
  return {
    accessToken,
    refreshToken,
    expiresInSeconds: 900,
    user: { id: demoUser.id, email, displayName: demoUser.displayName },
    tenant: { id: 'tnt-demo-1', slug: DEMO_TENANT_SLUG, name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
    role: demoUser.role,
  };
}

function unauthorized(message: string) {
  return mockError('UNAUTHORIZED', message);
}

function partyNotFound() {
  return mockError('NOT_FOUND', 'شخص مورد نظر پیدا نشد');
}

/**
 * ثبت فروش زیورآلات — مشترک میان مسیر نقدی (BE-041) و نسیه (BE-042).
 *
 * یک تابع، نه دو handler موازی: تفاوت واقعی این دو سمت سرور فقط سند
 * حسابداری و دو فیلد پرداخت است، نه قیمت‌گذاری، شماره‌گذاری یا اثر
 * موجودی — دو نسخه‌ی جدا یعنی دو جای مستقل برای واگرا شدن.
 */
/**
 * اثر سند روی مانده‌ی ریالی شخص — FE-098. مثبت = طلب فروشگاه از شخص (بدهکار)، منفی = بدهی
 * فروشگاه به شخص (بستانکار)؛ همان جهت `rawBalances.rial` ِ سرور. پیش‌تر فقط تسویه‌ها مانده را
 * جابه‌جا می‌کردند و فروش نسیه، خرید دست‌دوم، خرید مجدد و اصلاح فاکتور در «مانده» و «بدهکاران»
 * توسعه دیده نمی‌شدند، در حالی که سرور واقعی همه را در دفتر کل ثبت می‌کند.
 */
function postPartyRial(partyId: string, deltaRial: bigint): void {
  if (deltaRial === 0n) return;
  PARTY_RIAL_BALANCE[partyId] = (PARTY_RIAL_BALANCE[partyId] ?? 0n) + deltaRial;
}

async function registerJewelrySale(request: Request, mode: 'CASH' | 'CREDIT') {

await delay(WRITE_DELAY_MS);

const key = request.headers.get('Idempotency-Key');
if (!key) {
  return mockMissingIdempotencyKey();
}

// همان کلید = همان عملیات. فاکتور دوم ساخته نمی‌شود.
const cached = idempotencyCache.get(key);
if (cached) return HttpResponse.json(cached, { status: 201 });

const body = (await request.json()) as {
  partyId: string;
  jewelryItemId: string;
  quoteId: string;
  effectiveAt: string;
  paidRial?: string;
};

const version = jewelryItemList.find((item) => item.jewelryItemId === body.jewelryItemId);
const quote = maznehQuoteHistory.find((q) => q.id === body.quoteId);
if (!version || !quote) {
  return mockError('NOT_FOUND', !version ? 'کالای انتخاب‌شده پیدا نشد' : 'مظنه‌ی انتخاب‌شده پیدا نشد');
}

const calc = priceJewelryFromVersion(version, BigInt(quote.amountRial));

invoiceCounter += 1;
const paidRial = mode === 'CASH' ? calc.payableRial : BigInt(body.paidRial ?? '0');
// مانده هرگز منفی نمی‌شود — قرارداد `nonNegativeBigIntStringSchema` است
const receivableRial = calc.payableRial > paidRial ? calc.payableRial - paidRial : 0n;
postPartyRial(body.partyId, receivableRial);
const result = {
  invoiceId: crypto.randomUUID(),
  // شماره‌ی بدون شکاف — سرور واقعی با جدول شمارنده و SELECT ... FOR UPDATE
  invoiceNumber: invoiceCounter,
  invoicePeriod: MOCK_INVOICE_PERIOD,
  payableRial: calc.payableRial.toString(),
  ...(mode === 'CREDIT' ? { receivableRial: receivableRial.toString() } : {}),
  ledgerTransactionId: crypto.randomUUID(),
  inventoryMovementId: crypto.randomUUID(),
};

salesInvoiceVersions.set(result.invoiceId, {
  invoiceId: result.invoiceId,
  invoiceNumber: result.invoiceNumber,
  invoicePeriod: result.invoicePeriod,
  versions: [
    {
      version: 1,
      reason: null,
      reasonDetail: null,
      partyId: body.partyId,
      actor: { id: 'c1000000-0000-4000-8000-000000000002', displayName: 'مدیر فروشگاه' },
      createdAt: body.effectiveAt,
      payableRial: calc.payableRial.toString(),
      pureWeightMg: calc.pureWeightMg.toString(),
      karat: version.karat,
      items: [
        {
          itemType: 'JEWELRY',
          itemId: body.jewelryItemId,
          quantity: '1',
          pureWeightMg: calc.pureWeightMg.toString(),
          karat: version.karat,
        },
      ],
      totalsSnapshot: {
        payableRial: calc.payableRial.toString(),
        paidRial: paidRial.toString(),
        receivableRial: receivableRial.toString(),
        goldValueRial: calc.goldValueRial.toString(),
        wageRial: calc.wageRial.toString(),
        profitRial: calc.profitRial.toString(),
        taxRial: calc.taxRial.toString(),
        pureWeightMg: calc.pureWeightMg.toString(),
      },
      settingsSnapshot: {
        profitRateBps: MOCK_PROFIT_RATE_BPS.toString(),
        taxRateBps: MOCK_TAX_RATE_BPS.toString(),
      },
      ledgerEffects: [],
      inventoryEffects: [],
    },
  ],
});

const invoiceParty = partyList.find((candidate) => candidate.id === body.partyId);
if (invoiceParty) {
  salesInvoiceDetails.set(result.invoiceId, {
    id: result.invoiceId,
    invoiceNumber: result.invoiceNumber,
    invoicePeriod: result.invoicePeriod,
    status: 'FINALIZED',
    currentVersion: 1,
    party: {
      id: invoiceParty.id,
      displayName: invoiceParty.displayName,
      type: invoiceParty.type,
      status: invoiceParty.status,
    },
    occurredAt: body.effectiveAt,
    quoteSnapshot: {
      amountRial: quote.amountRial,
      goldRatePerGramRial: gramRate1000(BigInt(quote.amountRial)).toString(),
      observedAt: quote.observedAt,
    },
    versions: [
      {
        version: 1,
        reason: null,
        reasonDetail: null,
        actor: {
          id: 'c1000000-0000-4000-8000-000000000002',
          displayName: 'مدیر فروشگاه',
        },
        createdAt: body.effectiveAt,
        payableRial: calc.payableRial.toString(),
        paidRial: paidRial.toString(),
        receivableRial: receivableRial.toString(),
        pureWeightMg: calc.pureWeightMg.toString(),
        items: [
          {
            itemType: 'JEWELRY',
            itemId: body.jewelryItemId,
            title: version.title,
            quantity: '1',
            pureWeightMg: calc.pureWeightMg.toString(),
            karat: version.karat,
            payableRial: calc.payableRial.toString(),
          },
        ],
        settingsSnapshot: {
          baseQuoteKarat: null,
          mithqalGramsX10k: null,
          roundingUnitRial: DEFAULT_ROUNDING_UNIT.toString(),
          roundingPolicy: 'ROUND_HALF_UP',
          profitRateBps: MOCK_PROFIT_RATE_BPS.toString(),
          taxRateBps: MOCK_TAX_RATE_BPS.toString(),
        },
        ledgerSummary: {
          transactionCount: 1,
          entryCount: receivableRial === 0n ? 4 : 5,
          balanced: true,
        },
      },
    ],
  });
}

recordSalesInvoice({
  id: result.invoiceId,
  invoiceNumber: result.invoiceNumber,
  invoicePeriod: result.invoicePeriod,
  partyId: body.partyId,
  payableRial: result.payableRial,
  quoteAmountRial: quote.amountRial,
  occurredAt: body.effectiveAt,
});

// فروش یک قطعه‌ی فیزیکی است — همان کالا دیگر در انبار نیست
soldJewelryItems.set(body.jewelryItemId, version);
jewelryItemList = jewelryItemList.filter((item) => item.jewelryItemId !== body.jewelryItemId);

idempotencyCache.set(key, result);
return HttpResponse.json(result, { status: 201 });
}

function toCoinType(fixture: (typeof COIN_TYPE_VERSIONS)[number]): CoinType {
  const shared = {
    kind: 'coin' as const,
    id: fixture.coinTypeId,
    label: fixture.title,
    grossWeightUg: grossUg(BigInt(fixture.grossWeightUg)),
    karat: karat(fixture.karat),
  };
  return fixture.isCentralBankMinted ? { ...shared, isCentralBankMinted: true } : { ...shared, isCentralBankMinted: false };
}

/**
 * ثبت فروش سکه — BE-043، FE-048. برخلاف زیورآلات یک endpoint واحد است:
 * `paidRial` همیشه در بدنه است (صفر یا کامل یا بین این دو)، نه دو مسیر
 * جدا برای نقدی/نسیه.
 */
async function registerCoinSale(request: Request) {
  await delay(WRITE_DELAY_MS);

  const key = request.headers.get('Idempotency-Key');
  if (!key) {
    return mockMissingIdempotencyKey();
  }

  const cached = idempotencyCache.get(key);
  if (cached) return HttpResponse.json(cached, { status: 201 });

  const body = (await request.json()) as {
    partyId: string;
    coinTypeId: string;
    count: number;
    marketUnitPriceRial: string;
    quoteId: string;
    effectiveAt: string;
    paidRial: string;
  };

  const fixture = COIN_TYPE_VERSIONS.find((c) => c.coinTypeId === body.coinTypeId);
  const quote = maznehQuoteHistory.find((q) => q.id === body.quoteId);
  if (!fixture || !quote) {
    return mockError('NOT_FOUND', !fixture ? 'نوع سکه‌ی انتخاب‌شده پیدا نشد' : 'مظنه‌ی انتخاب‌شده پیدا نشد');
  }

  const coin = toCoinType(fixture);
  const rate1000 = gramRate1000(BigInt(quote.amountRial));
  const marketUnitPriceRial = rial(BigInt(body.marketUnitPriceRial));
  const intrinsicValueRial = intrinsicValue(coin, rate1000);
  const bubbleRial = coin.isCentralBankMinted ? bubble(coin, marketUnitPriceRial, rate1000) : null;
  const payableRial = coinPositionValue(body.count, marketUnitPriceRial);
  const paidRial = BigInt(body.paidRial);

  // آینه‌ی CoinSalePaidRialExceedsPayableError واقعی — برخلاف نسیه‌ی زیورآلات، اینجا رد می‌شود نه پذیرفته
  if (paidRial > payableRial) {
    return mockError('BAD_REQUEST', 'مبلغ پرداختی نمی‌تواند از مبلغ قابل‌پرداخت بیشتر باشد');
  }
  const receivableRial = payableRial - paidRial;
  postPartyRial(body.partyId, receivableRial);

  invoiceCounter += 1;
  const result = {
    invoiceId: crypto.randomUUID(),
    invoiceNumber: invoiceCounter,
    invoicePeriod: MOCK_INVOICE_PERIOD,
    payableRial: payableRial.toString(),
    receivableRial: receivableRial.toString(),
    intrinsicValueRial: intrinsicValueRial.toString(),
    bubbleRial: bubbleRial === null ? null : bubbleRial.toString(),
    ledgerTransactionId: crypto.randomUUID(),
    inventoryMovementId: crypto.randomUUID(),
  };

  salesInvoiceVersions.set(result.invoiceId, {
    invoiceId: result.invoiceId,
    invoiceNumber: result.invoiceNumber,
    invoicePeriod: result.invoicePeriod,
    versions: [
      {
        version: 1,
        reason: null,
        reasonDetail: null,
        partyId: body.partyId,
        actor: {
          id: 'c1000000-0000-4000-8000-000000000002',
          displayName: 'مدیر فروشگاه',
        },
        createdAt: body.effectiveAt,
        payableRial: payableRial.toString(),
        pureWeightMg: null,
        karat: fixture.karat,
        items: [
          {
            itemType: 'COIN',
            itemId: body.coinTypeId,
            quantity: String(body.count),
            pureWeightMg: null,
            karat: fixture.karat,
          },
        ],
        totalsSnapshot: {
          payableRial: payableRial.toString(),
          paidRial: paidRial.toString(),
          receivableRial: receivableRial.toString(),
          count: String(body.count),
          marketUnitPriceRial: marketUnitPriceRial.toString(),
          intrinsicValueRial: intrinsicValueRial.toString(),
          bubbleRial: bubbleRial === null ? null : bubbleRial.toString(),
        },
        settingsSnapshot: {},
        ledgerEffects: [],
        inventoryEffects: [],
      },
    ],
  });

  const invoiceParty = partyList.find((candidate) => candidate.id === body.partyId);
  if (invoiceParty) {
    salesInvoiceDetails.set(result.invoiceId, {
      id: result.invoiceId,
      invoiceNumber: result.invoiceNumber,
      invoicePeriod: result.invoicePeriod,
      status: 'FINALIZED',
      currentVersion: 1,
      party: {
        id: invoiceParty.id,
        displayName: invoiceParty.displayName,
        type: invoiceParty.type,
        status: invoiceParty.status,
      },
      occurredAt: body.effectiveAt,
      quoteSnapshot: {
        amountRial: quote.amountRial,
        goldRatePerGramRial: rate1000.toString(),
        observedAt: quote.observedAt,
      },
      versions: [
        {
          version: 1,
          reason: null,
          reasonDetail: null,
          actor: {
            id: 'c1000000-0000-4000-8000-000000000002',
            displayName: 'مدیر فروشگاه',
          },
          createdAt: body.effectiveAt,
          payableRial: payableRial.toString(),
          paidRial: paidRial.toString(),
          receivableRial: receivableRial.toString(),
          pureWeightMg: null,
          items: [
            {
              itemType: 'COIN',
              itemId: body.coinTypeId,
              title: fixture.title,
              quantity: String(body.count),
              pureWeightMg: null,
              karat: fixture.karat,
              payableRial: payableRial.toString(),
            },
          ],
          settingsSnapshot: {
            baseQuoteKarat: null,
            mithqalGramsX10k: null,
            roundingUnitRial: null,
            roundingPolicy: null,
            profitRateBps: null,
            taxRateBps: null,
          },
          ledgerSummary: {
            transactionCount: 1,
            entryCount: paidRial > 0n && receivableRial > 0n ? 5 : 4,
            balanced: true,
          },
        },
      ],
    });
  }

  recordSalesInvoice({
    id: result.invoiceId,
    invoiceNumber: result.invoiceNumber,
    invoicePeriod: result.invoicePeriod,
    partyId: body.partyId,
    payableRial: result.payableRial,
    quoteAmountRial: quote.amountRial,
    occurredAt: body.effectiveAt,
  });

  // موجودی همان نوع کم می‌شود — منفی هم می‌تواند بشود، دقیقاً مثل موجودی واقعی
  const existingBalance = COIN_BALANCE_ROWS.find((row) => row.itemId === body.coinTypeId);
  if (existingBalance) {
    existingBalance.quantity = (BigInt(existingBalance.quantity) - BigInt(body.count)).toString();
  } else {
    // `itemId` در نوع استنتاج‌شده‌ی COIN_BALANCE_ROWS محدود به سه شناسه‌ی اولیه است؛
    // اینجا هر نوع سکه‌ی معتبری می‌تواند برای اولین بار حرکت بگیرد.
    (COIN_BALANCE_ROWS as { itemType: 'COIN'; itemId: string; quantity: string }[]).push({
      itemType: 'COIN',
      itemId: body.coinTypeId,
      quantity: (-BigInt(body.count)).toString(),
    });
  }

  idempotencyCache.set(key, result);
  return HttpResponse.json(result, { status: 201 });
}

/** عیار پیش‌فرض خرید از مصرف‌کننده — رکورد تنظیمات نسخه‌دار، نه عدد هاردکد (قاعده‌ی ۲-۶). */
function secondHandDefaultKarat(): number {
  return Number.parseInt(mockGeneralSettings.get('purchase.second_hand_default_karat')?.value ?? '', 10);
}

/** محاسبه‌ی خرید دست‌دوم — مشترک خرید مستقیم و خرید مجدد B2C، مثل `SecondHandGoldPurchasesService`. */
function secondHandGoldCalculation(
  body: { grossWeightMg: string; stoneWeightMg: string; otherDeductionWeightMg: string; purchaseKarat?: number | undefined },
  maznehRial: bigint,
  feeRial: bigint,
) {
  return calculateSecondHandGoldPurchase({
    grossWeightMg: BigInt(body.grossWeightMg),
    deductions: { stone: grossMg(BigInt(body.stoneWeightMg)), other: grossMg(BigInt(body.otherDeductionWeightMg)) },
    purchaseKarat: karat(body.purchaseKarat ?? secondHandDefaultKarat()),
    maznehRial,
    feeRial,
    roundingUnitRial: DEFAULT_ROUNDING_UNIT,
    rateDivisor: RATE_DIVISOR,
  });
}

/** فروش اولیه‌ی یک خرید مجدد B2C — آینه‌ی `loadOriginalJewelrySaleInTransaction` سرور. */
function originalJewelrySale(invoiceId: string):
  | { readonly ok: false; readonly response: Response }
  | {
      readonly ok: true;
      readonly detail: SalesInvoiceDetail;
      readonly quote: NonNullable<SalesInvoiceDetail['quoteSnapshot']>;
      readonly purchaseAmountRial: bigint;
      readonly calculation: ReturnType<typeof priceJewelryFromVersion>;
    } {
  const detail = salesInvoiceDetails.get(invoiceId);
  if (!detail) return { ok: false, response: mockError('NOT_FOUND', 'فاکتور مورد نظر پیدا نشد') };
  const current = detail.versions.find((version) => version.version === detail.currentVersion);
  if (detail.status !== 'FINALIZED' || detail.quoteSnapshot === null || current === undefined) {
    return { ok: false, response: mockError('BAD_REQUEST', 'فقط فاکتور نهایی‌شده قابل خرید مجدد است') };
  }
  if (detail.party.type !== 'CONSUMER' || detail.party.status !== 'ACTIVE') {
    return { ok: false, response: mockError('BAD_REQUEST', 'خرید مجدد فقط برای مصرف‌کننده‌ی فعال ممکن است') };
  }
  const [item, ...rest] = current.items;
  const jewelry = item?.itemType === 'JEWELRY' && rest.length === 0 ? findJewelryVersion(item.itemId) : undefined;
  if (jewelry === undefined) {
    return { ok: false, response: mockError('BAD_REQUEST', 'این فاکتور یک قطعه‌ی زیورآلات قابل خرید مجدد ندارد') };
  }
  return {
    ok: true,
    detail,
    quote: detail.quoteSnapshot,
    // مبلغ اولیه همان snapshot ِ قفل‌شده‌ی فاکتور است (قاعده‌ی ۲-۸)، نه بازمحاسبه با امروز.
    purchaseAmountRial: BigInt(current.payableRial),
    calculation: priceJewelryFromVersion(jewelry, BigInt(detail.quoteSnapshot.amountRial)),
  };
}

/** مقایسه‌ی فروش اولیه با خرید امروز — همان `calculateB2cBuybackDifference` ِ core-calc. */
function b2cBuybackComparison(
  original: Extract<ReturnType<typeof originalJewelrySale>, { ok: true }>,
  body: { grossWeightMg: string; stoneWeightMg: string; otherDeductionWeightMg: string; purchaseKarat?: number | undefined },
  quote: { amountRial: string },
) {
  const today = secondHandGoldCalculation(body, BigInt(quote.amountRial), 0n);
  const difference = calculateB2cBuybackDifference({
    originalPurchaseAmountRial: rial(original.purchaseAmountRial),
    originalGoldValueRial: original.calculation.goldValueRial,
    originalWageRial: original.calculation.wageRial,
    originalPureWeightMg: original.calculation.pureWeightMg,
    todayGrossPurchaseAmountRial: today.grossPurchaseAmountRial,
    todayPurchaseAmountRial: today.finalAmountRial,
    todayGoldRatePerGramRial: today.goldRatePerGramRial,
  });
  return {
    today,
    breakdown: {
      originalPurchaseAmountRial: original.purchaseAmountRial.toString(),
      todayPurchaseAmountRial: today.finalAmountRial.toString(),
      differenceRial: difference.differenceRial.toString(),
      wageBurnedRial: difference.wageBurnedRial.toString(),
      karatDifferenceRial: difference.karatDifferenceRial.toString(),
      marketPriceDifferenceRial: difference.marketPriceDifferenceRial.toString(),
      otherCalculationDifferenceRial: difference.otherCalculationDifferenceRial.toString(),
    },
  };
}

/**
 * سیاست اصلاح — همان تنظیم نسخه‌دار `sales.invoice_correction_window_minutes`. فاکتورهای
 * fixture قدیمی‌اند و خارج پنجره؛ فاکتوری که در همین نشست ثبت شود تا پایان پنجره اصلاح‌پذیر است.
 */
function amendmentPolicyFor(detail: SalesInvoiceDetail) {
  const windowMinutes = BigInt(mockGeneralSettings.get('sales.invoice_correction_window_minutes')?.value ?? '0');
  const elapsedMs = BigInt(Date.now()) - BigInt(new Date(detail.occurredAt).getTime());
  const restrictions: Array<'INVOICE_NOT_FINALIZED' | 'OUTSIDE_CORRECTION_WINDOW'> = [];
  if (detail.status !== 'FINALIZED') restrictions.push('INVOICE_NOT_FINALIZED');
  else if (elapsedMs > windowMinutes * 60_000n) restrictions.push('OUTSIDE_CORRECTION_WINDOW');
  return {
    invoiceId: detail.id,
    invoiceVersion: detail.currentVersion,
    evaluatedAt: new Date().toISOString(),
    allowed: restrictions.length === 0,
    requiresManagerAuthorization: restrictions.includes('OUTSIDE_CORRECTION_WINDOW'),
    restrictions,
  };
}

export const handlers = [
  // FE-093: سناریو، Idempotency-Key و schema ِ بدنه پیش از هر مسیر — مثل middleware و pipe سرور.
  contractGate,
  http.post('/api/purchase/second-hand/gold', async ({ request }) => {
    await delay(WRITE_DELAY_MS);
    const key = request.headers.get('Idempotency-Key');
    if (!key) return mockMissingIdempotencyKey();
    const parsed = createSecondHandGoldPurchaseSchema.safeParse(await request.json());
    if (!parsed.success) return mockValidationError(parsed.error);
    const cacheKey = `purchase:${key}`;
    const cached = idempotencyCache.get(cacheKey);
    if (cached) return HttpResponse.json(cached, { status: 201 });
    const body = parsed.data;
    const party = partyList.find((p) => p.id === body.partyId);
    const quote = maznehQuoteHistory.find((q) => q.id === body.quoteId);
    // نگاشت `second-hand-gold-purchases.controller.ts`: شخص ناموجود ← ۴۰۴؛ غیرمصرف‌کننده/مظنه ← ۴۰۰.
    if (party === undefined) return mockError('NOT_FOUND', 'فروشنده پیدا نشد');
    if (party.type !== 'CONSUMER' || party.status !== 'ACTIVE') {
      return mockError('BAD_REQUEST', 'خرید دست‌دوم فقط از مصرف‌کننده‌ی فعال ممکن است');
    }
    if (!quote) return mockError('BAD_REQUEST', 'مظنه‌ی انتخاب‌شده پیدا نشد');
    try {
      // عیار حذف‌شده = تنظیم نسخه‌دار مستأجر، همان کاری که سرور می‌کند — نه خطا.
      const calc = secondHandGoldCalculation(body, BigInt(quote.amountRial), BigInt(body.feeRial));
      if (BigInt(body.paidRial) > calc.finalAmountRial) return mockError('BAD_REQUEST', 'پرداخت بیشتر از مبلغ خرید است');
      const result = {
        secondHandPurchaseId: crypto.randomUUID(), ledgerTransactionId: crypto.randomUUID(), inventoryMovementId: crypto.randomUUID(),
        pureWeightMg: calc.pureWeightMg.toString(), goldRatePerGramRial: calc.goldRatePerGramRial.toString(),
        grossPurchaseAmountRial: calc.grossPurchaseAmountRial.toString(), feeRial: body.feeRial,
        finalAmountRial: calc.finalAmountRial.toString(), paidRial: body.paidRial,
        payableRial: (calc.finalAmountRial - BigInt(body.paidRial)).toString(),
      };
      mockSecondHandPurchaseIds.add(result.secondHandPurchaseId);
      postPartyRial(body.partyId, -BigInt(result.payableRial));
      idempotencyCache.set(cacheKey, result);
      return HttpResponse.json(result, { status: 201 });
    } catch {
      return mockError('BAD_REQUEST', 'محاسبه خرید نامعتبر است');
    }
  }),

  http.post('/api/purchase/second-hand/coins', async ({ request }) => {
    await delay(WRITE_DELAY_MS);
    const key = request.headers.get('Idempotency-Key');
    if (!key) return mockMissingIdempotencyKey();
    const parsed = createSecondHandCoinPurchaseSchema.safeParse(await request.json());
    if (!parsed.success) return mockValidationError(parsed.error);
    const cacheKey = `coin-purchase:${key}`;
    const cached = idempotencyCache.get(cacheKey);
    if (cached) return HttpResponse.json(cached, { status: 201 });
    const body = parsed.data;
    const party = partyList.find((candidate) => candidate.id === body.partyId);
    const fixture = COIN_TYPE_VERSIONS.find((candidate) => candidate.coinTypeId === body.coinTypeId && candidate.active);
    const quote = maznehQuoteHistory.find((candidate) => candidate.id === body.quoteId);
    // نگاشت `second-hand-coin-purchases.controller.ts`: شخص/نوع سکه ناموجود ← ۴۰۴؛ بقیه ← ۴۰۰.
    if (party === undefined) return mockError('NOT_FOUND', 'فروشنده پیدا نشد');
    if (fixture === undefined) return mockError('NOT_FOUND', 'نوع سکه پیدا نشد');
    if (party.type !== 'CONSUMER' || party.status !== 'ACTIVE') {
      return mockError('BAD_REQUEST', 'خرید دست‌دوم فقط از مصرف‌کننده‌ی فعال ممکن است');
    }
    if (!quote) return mockError('BAD_REQUEST', 'مظنه‌ی انتخاب‌شده پیدا نشد');
    const unitPrice = rial(BigInt(body.purchaseUnitPriceRial));
    const purchaseAmount = coinPositionValue(body.count, unitPrice);
    const paid = BigInt(body.paidRial);
    if (paid > purchaseAmount) return mockError('BAD_REQUEST', 'پرداخت نمی‌تواند بیشتر از مبلغ خرید باشد');
    const coin = toCoinType(fixture);
    const rate1000 = gramRate1000(BigInt(quote.amountRial));
    const intrinsic = intrinsicValue(coin, rate1000);
    const coinBubble = coin.isCentralBankMinted ? bubble(coin, unitPrice, rate1000) : null;
    const result = {
      secondHandPurchaseId: crypto.randomUUID(), ledgerTransactionId: crypto.randomUUID(),
      inventoryMovementId: crypto.randomUUID(), coinTypeId: body.coinTypeId, count: body.count,
      purchaseUnitPriceRial: unitPrice.toString(), purchaseAmountRial: purchaseAmount.toString(),
      paidRial: paid.toString(), payableRial: (purchaseAmount - paid).toString(),
      intrinsicValueRial: intrinsic.toString(), bubbleRial: coinBubble?.toString() ?? null,
    };
    mockSecondHandPurchaseIds.add(result.secondHandPurchaseId);
    postPartyRial(body.partyId, -(purchaseAmount - paid));
    const existingBalance = COIN_BALANCE_ROWS.find((row) => row.itemId === body.coinTypeId);
    if (existingBalance) existingBalance.quantity = (BigInt(existingBalance.quantity) + BigInt(body.count)).toString();
    else (COIN_BALANCE_ROWS as { itemType: 'COIN'; itemId: string; quantity: string }[]).push({ itemType: 'COIN', itemId: body.coinTypeId, quantity: body.count.toString() });
    idempotencyCache.set(cacheKey, result);
    return HttpResponse.json(result, { status: 201 });
  }),
  http.post('/api/auth/login', async ({ request }) => {
    await delay(WRITE_DELAY_MS);

    // `/auth` مسیر عمومی سرور است: نه کلید می‌خواهد نه پاسخ را برای کلید نگه می‌دارد —
    // هر ورود موفق نشست تازه‌ای است (`AuthController.login`).
    const body = (await request.json()) as { email: string; password: string; tenantSlug: string };
    const demoUser = Object.hasOwn(DEMO_USERS, body.email)
      ? (body.email as keyof typeof DEMO_USERS)
      : undefined;

    // پیام دقیقاً همان چیزی است که InvalidCredentialsError (auth.errors.ts) برمی‌گرداند
    if (demoUser === undefined || body.password !== DEMO_PASSWORD || body.tenantSlug !== DEMO_TENANT_SLUG) {
      return unauthorized('ایمیل یا رمز عبور نادرست است');
    }

    return HttpResponse.json(issueSession(crypto.randomUUID(), demoUser));
  }),

  http.post('/api/auth/refresh', async ({ request }) => {
    await delay(WRITE_DELAY_MS);

    const key = request.headers.get('Idempotency-Key');
    if (key) {
      const cached = idempotencyCache.get(key);
      if (cached) return HttpResponse.json(cached);
    }

    const body = (await request.json()) as { refreshToken: string };
    const demoUser = validRefreshTokens.get(body.refreshToken);

    // پیام دقیقاً همان چیزی است که InvalidRefreshTokenError برمی‌گرداند
    if (demoUser === undefined) {
      return unauthorized('نشست معتبر نیست یا منقضی شده است');
    }

    // چرخش توکن — توکن قبلی همین الان مصرف‌شده و باطل حساب می‌شود
    validRefreshTokens.delete(body.refreshToken);
    const result = issueSession(key ?? crypto.randomUUID(), demoUser);
    if (key) idempotencyCache.set(key, result);
    return HttpResponse.json(result);
  }),

  http.post('/api/auth/logout', async ({ request }) => {
    await delay(WRITE_DELAY_MS);

    const body = (await request.json()) as { refreshToken: string };
    // موفق حتی برای توکن ناموجود — همان رفتار BE-011 (auth.service.ts)
    validRefreshTokens.delete(body.refreshToken);
    return new HttpResponse(null, { status: 204 });
  }),

  /**
   * `GET /pricing/quotes/latest` — قرارداد نهایی BE-021، دقیقاً همان
   * `priceQuoteSchema` واقعی. `FETCHED_AT` عمداً قدیمی مانده (بخش بالای
   * fixtures.ts) تا حالت «قدیمی» ویجت مظنه بدون کار اضافه قابل‌آزمون بماند.
   */
  http.get('/api/pricing/quotes/latest', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const quoteType = new URL(request.url).searchParams.get('quoteType');
    if (quoteType !== 'MAZNEH') return HttpResponse.json(null);

    return HttpResponse.json(maznehQuoteHistory[0] ?? null);
  }),

  /**
   * `GET /pricing/quotes` — قرارداد `priceQuoteHistoryQuerySchema`: `quoteType` اختیاری و
   * `limit` (پیش‌فرض و سقف `MAX_PAGE_SIZE`)؛ مثل `list()` واقعی فقط تازه‌ترین‌ها (M-13).
   * صفحه‌بندی سمت کلاینت در `QuoteHistoryList` (FE-031) روی همین آرایه انجام می‌شود.
   */
  http.get('/api/pricing/quotes', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const query = priceQuoteHistoryQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return mockValidationError(query.error);
    const { quoteType, limit } = query.data;
    const filtered =
      quoteType === undefined ? maznehQuoteHistory : maznehQuoteHistory.filter((q) => q.quoteType === quoteType);

    return HttpResponse.json(filtered.slice(0, limit));
  }),

  /**
   * `POST /pricing/quotes/manual` — قرارداد نهایی BE-021
   * (`createManualPriceQuoteSchema`): فقط `quoteType` و `amountRial`.
   * بدون `observedAt` یا `description` ورودی — سرور واقعی هم `observedAt`
   * را خودش می‌سازد (`price-quotes.service.ts`) و ستون توضیحی اصلاً وجود
   * ندارد؛ FE-030 هم به همین شکل فقط مبلغ را می‌گیرد.
   */
  http.post('/api/pricing/quotes/manual', async ({ request }) => {
    await delay(WRITE_DELAY_MS);

    const key = request.headers.get('Idempotency-Key');
    if (!key) {
      return mockMissingIdempotencyKey();
    }

    const cached = idempotencyCache.get(key);
    if (cached) return HttpResponse.json(cached, { status: 201 });

    const body = (await request.json()) as { quoteType: 'MAZNEH'; amountRial: string };
    const now = new Date().toISOString();
    const created = {
      id: crypto.randomUUID(),
      quoteType: body.quoteType,
      amountRial: body.amountRial,
      source: 'MANUAL' as const,
      observedAt: now,
      createdBy: 'c1000000-0000-4000-8000-000000000002',
      createdAt: now,
    };
    // تازه‌ترین اول — همان ترتیب `orderBy(desc(observedAt), ...)` واقعی
    maznehQuoteHistory = [created, ...maznehQuoteHistory];
    idempotencyCache.set(key, created);
    return HttpResponse.json(created, { status: 201 });
  }),

  /**
   * `GET /pricing/feed/status` — FE-082، همان `priceFeedStatusSchema` واقعی.
   * منبع فعال = آخرین مظنه‌ی ذخیره‌شده؛ آخرین مظنه‌ی هر منبع از همان تاریخچه.
   * provider mock «پیکربندی‌شده» است تا مسیر fallback در dev دیده شود.
   */
  http.get('/api/pricing/feed/status', async () => {
    await delay(READ_DELAY_MS);
    return HttpResponse.json({
      quoteType: 'MAZNEH',
      providerConfigured: true,
      activeQuote: maznehQuoteHistory[0] ?? null,
      latestFeedQuote: maznehQuoteHistory.find((quote) => quote.source === 'FEED') ?? null,
      latestManualQuote: maznehQuoteHistory.find((quote) => quote.source === 'MANUAL') ?? null,
      checkedAt: new Date().toISOString(),
    });
  }),

  /**
   * `POST /pricing/feed/refresh` — FE-082. mock هیچ فید واقعی‌ای ندارد، پس همیشه
   * مثل provider قطع رفتار می‌کند: fallback به آخرین مظنه‌ی ذخیره‌شده (یا
   * `UNAVAILABLE` اگر هیچ مظنه‌ای نباشد) — دقیقاً همان قرارداد سرور.
   */
  http.post('/api/pricing/feed/refresh', async ({ request }) => {
    await delay(WRITE_DELAY_MS);
    const key = request.headers.get('Idempotency-Key');
    if (!key) {
      return mockMissingIdempotencyKey();
    }
    const cached = idempotencyCache.get(key);
    if (cached) return HttpResponse.json(cached);

    const latest = maznehQuoteHistory[0];
    const body = latest
      ? { outcome: 'FALLBACK' as const, failure: 'PROVIDER_TIMEOUT' as const, quote: latest }
      : { outcome: 'UNAVAILABLE' as const, failure: 'PROVIDER_TIMEOUT' as const, quote: null };
    idempotencyCache.set(key, body);
    return HttpResponse.json(body);
  }),

  /**
   * `GET /parties` — قرارداد نهایی BE-024 (`partyListQuerySchema`/`partyListSchema`):
   * `search` نام **یا** موبایل را می‌گردد، `type`/`status` فیلتر می‌کنند،
   * `limit`/`offset` صفحه‌بندی سرور-محور واقعی است (نه سمت کلاینت مثل
   * تاریخچه‌ی مظنه) — همان ترتیب `list()` واقعی: نام صعودی.
   */
  http.get('/api/parties', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const params = new URL(request.url).searchParams;
    const search = params.get('search');
    const type = params.get('type');
    const status = params.get('status');
    const limit = Number.parseInt(params.get('limit') ?? String(DEFAULT_PAGE_SIZE), 10);
    const offset = Number.parseInt(params.get('offset') ?? '0', 10);

    const filtered = partyList
      .filter((p) => (type ? p.type === type : true))
      .filter((p) => (status ? p.status === status : true))
      .filter((p) => matchesQuery(p.displayName, search) || matchesMobile(p.mobile, search))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fa'));

    return HttpResponse.json({
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    });
  }),

  /** `POST /parties` — قرارداد نهایی BE-024 (`createPartySchema`/`partySchema`). */
  http.post('/api/parties', async ({ request }) => {
    await delay(WRITE_DELAY_MS);

    const key = request.headers.get('Idempotency-Key');
    if (!key) {
      return mockMissingIdempotencyKey();
    }

    const cached = idempotencyCache.get(key);
    if (cached) return HttpResponse.json(cached, { status: 201 });

    const body = (await request.json()) as {
      type: Party['type'];
      displayName: string;
      mobile?: string;
      nationalId?: string;
      notes?: string;
    };
    const now = new Date().toISOString();
    const created: Party = {
      id: crypto.randomUUID(),
      type: body.type,
      displayName: body.displayName,
      mobile: body.mobile ?? null,
      nationalId: body.nationalId ?? null,
      linkedTenantId: null,
      status: 'ACTIVE',
      notes: body.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    partyList = [...partyList, created];
    idempotencyCache.set(key, created);
    return HttpResponse.json(created, { status: 201 });
  }),

  /** `PATCH /api/parties/:id` — قرارداد نهایی BE-024 (`updatePartySchema`/`partySchema`، FE-033). */
  http.patch('/api/parties/:id', async ({ request, params }) => {
    await delay(WRITE_DELAY_MS);

    const key = request.headers.get('Idempotency-Key');
    if (!key) {
      return mockMissingIdempotencyKey();
    }

    const cached = idempotencyCache.get(key);
    if (cached) return HttpResponse.json(cached, { status: 200 });

    const id = params['id'] as string;
    const existing = partyList.find((p) => p.id === id);
    if (!existing) {
      return mockError('NOT_FOUND', 'شخص مورد نظر پیدا نشد');
    }

    const body = (await request.json()) as {
      type?: Party['type'];
      displayName?: string;
      mobile?: string | null;
      nationalId?: string | null;
      notes?: string | null;
    };
    const updated: Party = {
      ...existing,
      ...(body.type !== undefined && { type: body.type }),
      ...(body.displayName !== undefined && { displayName: body.displayName }),
      ...(body.mobile !== undefined && { mobile: body.mobile }),
      ...(body.nationalId !== undefined && { nationalId: body.nationalId }),
      ...(body.notes !== undefined && { notes: body.notes }),
      updatedAt: new Date().toISOString(),
    };
    partyList = partyList.map((p) => (p.id === id ? updated : p));
    idempotencyCache.set(key, updated);
    return HttpResponse.json(updated, { status: 200 });
  }),

  /*
   * از این‌جا به بعد handlerهای الگودار `/api/parties/:id...` می‌آیند. MSW به ترتیب تعریف
   * تطبیق می‌دهد، پس هر مسیر ثابت ِ `/api/parties/<کلمه>` باید پیش از این‌ها تعریف شود،
   * وگرنه `:id` آن کلمه را شناسه می‌گیرد.
   */

  /** `GET /parties/:id` — قرارداد نهایی BE-024 (`partySchema`، FE-034). */
  http.get('/api/parties/:id', async ({ params }) => {
    await delay(READ_DELAY_MS);
    const found = partyList.find((p) => p.id === params['id']);
    return found ? HttpResponse.json(found) : partyNotFound();
  }),

  /**
   * `GET /parties/:id/balances` — قرارداد نهایی BE-056 (`partyBalancesSchema`،
   * FE-034). `referenceQuoteId` باید یکی از `maznehQuoteHistory` باشد؛ اگر
   * داده نشده یا پیدا نشده، دقیقاً همان تفاوت رفتار سرور واقعی را می‌دهد
   * (`convertedView: null` در برابر ۴۰۴).
   */
  http.get('/api/parties/:id/balances', async ({ params, request }) => {
    await delay(READ_DELAY_MS);
    const id = params['id'] as string;
    const party = partyList.find((p) => p.id === id);
    if (!party) return partyNotFound();

    const referenceQuoteId = new URL(request.url).searchParams.get('referenceQuoteId');
    if (referenceQuoteId) {
      const quote = maznehQuoteHistory.find((q) => q.id === referenceQuoteId);
      if (!quote) {
        return mockError('NOT_FOUND', 'مظنه‌ی مرجع پیدا نشد');
      }
      return HttpResponse.json(
        partyBalancesFor({ id, mg: partyMgById[id] ?? 0 }, quote),
      );
    }

    return HttpResponse.json(partyBalancesFor({ id, mg: partyMgById[id] ?? 0 }, undefined));
  }),

  /**
   * `GET /parties/:id/statement` — قرارداد نهایی BE-057 (`partyStatementSchema`).
   * فیلترهای بازه/نوع سند/بُعد مثل سرور واقعی پیش از صفحه‌بندی اعمال
   * می‌شوند (FE-070)؛ `runningBalance` ساختگی fixture دست‌نخورده می‌ماند،
   * همان‌طور که سرور مانده را پیش از فیلتر روی کل دفتر حساب می‌کند.
   */
  http.get('/api/parties/:id/statement', async ({ params, request }) => {
    await delay(READ_DELAY_MS);
    const id = params['id'] as string;
    const party = partyList.find((p) => p.id === id);
    if (!party) return partyNotFound();

    const searchParams = new URL(request.url).searchParams;
    const limit = Number.parseInt(searchParams.get('limit') ?? '50', 10);
    const offset = Number.parseInt(searchParams.get('offset') ?? '0', 10);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const sourceType = searchParams.get('sourceType');
    const dimensionId = searchParams.get('dimensionId');
    const all = partyStatementEntriesFor({ id, mg: partyMgById[id] ?? 0 });
    const entries = all
      .filter((entry) => !from || entry.effectiveAt >= new Date(from).toISOString())
      .filter((entry) => !to || entry.effectiveAt <= new Date(to).toISOString())
      .filter((entry) => !sourceType || entry.source.type === sourceType)
      .filter((entry) => !dimensionId || entry.dimension.id === dimensionId)
      .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
    // M-15: `order=desc` فقط ترتیب است؛ `dimensions` از کل دفتر شخص، مستقل از فیلتر و صفحه.
    const ordered = searchParams.get('order') === 'desc' ? [...entries].reverse() : entries;
    const kindRank = { RIAL: 0, GOLD: 1, SILVER: 2, COIN: 3 } as const;
    const dimensions = [...new Map(all.map((entry) => [entry.dimension.id, entry.dimension])).values()].sort(
      (left, right) => kindRank[left.kind] - kindRank[right.kind],
    );

    return HttpResponse.json({
      items: ordered.slice(offset, offset + limit),
      total: entries.length,
      limit,
      offset,
      partyId: id,
      displayReferenceMazneh: null,
      dimensions,
    });
  }),

  /** `GET /reporting/debtors|creditors` — قرارداد نهایی BE-058 (`partyBalanceReportSchema`، FE-072/FE-073). */
  ...(['debtors', 'creditors'] as const).map((path) =>
    http.get(`/api/reporting/${path}`, async ({ request }) => {
      await delay(READ_DELAY_MS);
      const searchParams = new URL(request.url).searchParams;
      const quote = maznehQuoteHistory.find((q) => q.id === searchParams.get('referenceQuoteId'));
      if (!quote) {
        return mockError('NOT_FOUND', 'مظنه‌ی مرجع پیدا نشد');
      }
      return HttpResponse.json(
        partyBalanceReportFor(path === 'debtors' ? 'DEBTOR' : 'CREDITOR', partyList, quote, {
          search: searchParams.get('search')?.trim() || null,
          displayUnit: searchParams.get('displayUnit') === 'RIAL' ? 'RIAL' : 'GOLD',
          sortDirection: searchParams.get('sortDirection') === 'ASC' ? 'ASC' : 'DESC',
          limit: Number.parseInt(searchParams.get('limit') ?? String(DEFAULT_PAGE_SIZE), 10),
          offset: Number.parseInt(searchParams.get('offset') ?? '0', 10),
        }),
      );
    }),
  ),

  /** `POST /parties/:id/deactivate` — قرارداد نهایی BE-024 (`partySchema`، FE-034). */
  http.post('/api/parties/:id/deactivate', async ({ params, request }) => {
    await delay(WRITE_DELAY_MS);

    const key = request.headers.get('Idempotency-Key');
    if (!key) {
      return mockMissingIdempotencyKey();
    }

    const cached = idempotencyCache.get(key);
    if (cached) return HttpResponse.json(cached, { status: 200 });

    const id = params['id'] as string;
    const existing = partyList.find((p) => p.id === id);
    if (!existing) return partyNotFound();

    const updated: Party = { ...existing, status: 'INACTIVE', updatedAt: new Date().toISOString() };
    partyList = partyList.map((p) => (p.id === id ? updated : p));
    idempotencyCache.set(key, updated);
    return HttpResponse.json(updated, { status: 200 });
  }),

  /**
   * `POST /parties/:partyId/settlements/rial` — قرارداد نهایی BE-045
   * (`createRialSettlementSchema`/`rialSettlementSchema`)، FE-051.
   *
   * تک‌بعدی — بدون تبدیل واحد، بدون سقف: سرور واقعی (`RialSettlementsService`)
   * هیچ مقایسه‌ای با مانده‌ی جاری ندارد؛ پرداخت بیشتر از طلب فقط شخص را از
   * بدهکار به بستانکار می‌برد، خطا نیست.
   */
  http.post('/api/parties/:partyId/settlements/rial', async ({ request, params }) => {
    await delay(WRITE_DELAY_MS);

    const key = request.headers.get('Idempotency-Key');
    if (!key) {
      return mockMissingIdempotencyKey();
    }

    const cached = idempotencyCache.get(key);
    if (cached) return HttpResponse.json(cached, { status: 201 });

    const partyId = params['partyId'] as string;
    const party = partyList.find((p) => p.id === partyId);
    if (!party) return partyNotFound();

    const body = (await request.json()) as { amountRial: string; effectiveAt: string };
    const amountRial = BigInt(body.amountRial);

    // بدهکار کم می‌شود؛ رد شدن از صفر یعنی شخص بستانکار می‌شود — طبیعی است
    PARTY_RIAL_BALANCE[partyId] = (PARTY_RIAL_BALANCE[partyId] ?? 0n) - amountRial;

    const result = {
      settlementId: crypto.randomUUID(),
      ledgerTransactionId: crypto.randomUUID(),
      amountRial: body.amountRial,
    };

    idempotencyCache.set(key, result);
    return HttpResponse.json(result, { status: 201 });
  }),

  /**
   * `POST /parties/:partyId/settlements/gold` — قرارداد نهایی BE-046
   * (`createGoldSettlementSchema`/`goldSettlementSchema`)، FE-052.
   *
   * دریافت طلا برای تسویه — سرور خودش وزن خالص و مبلغ را از روی
   * `quoteId` قفل‌شده حساب می‌کند، نه از عددی که کلاینت پیش‌نمایش داده.
   */
  http.post('/api/parties/:partyId/settlements/gold', async ({ request, params }) => {
    await delay(WRITE_DELAY_MS);

    const key = request.headers.get('Idempotency-Key');
    if (!key) {
      return mockMissingIdempotencyKey();
    }

    const cached = idempotencyCache.get(key);
    if (cached) return HttpResponse.json(cached, { status: 201 });

    const partyId = params['partyId'] as string;
    const party = partyList.find((p) => p.id === partyId);
    if (!party) return partyNotFound();

    const body = (await request.json()) as {
      grossWeightMg: string;
      karat: number;
      quoteId: string;
      effectiveAt: string;
    };
    const quote = maznehQuoteHistory.find((q) => q.id === body.quoteId);
    if (!quote) {
      return mockError('NOT_FOUND', 'مظنه‌ی انتخاب‌شده پیدا نشد');
    }

    const rate1000 = gramRate1000(BigInt(quote.amountRial));
    const pureWeightMg = toPureMg(grossMg(BigInt(body.grossWeightMg)), karat(body.karat));
    const settledRial = valueOfPure(pureWeightMg, rate1000);

    // بدهکار کم می‌شود؛ رد شدن از صفر یعنی شخص بستانکار می‌شود — طبیعی است
    PARTY_RIAL_BALANCE[partyId] = (PARTY_RIAL_BALANCE[partyId] ?? 0n) - settledRial;

    const result = {
      settlementId: crypto.randomUUID(),
      ledgerTransactionId: crypto.randomUUID(),
      inventoryMovementId: crypto.randomUUID(),
      pureWeightMg: pureWeightMg.toString(),
      settledRial: settledRial.toString(),
      goldRatePerGramRial: rate1000.toString(),
    };

    idempotencyCache.set(key, result);
    return HttpResponse.json(result, { status: 201 });
  }),

  /**
   * `POST /parties/:partyId/settlements/coins` — قرارداد نهایی BE-047
   * (`createCoinSettlementSchema`/`coinSettlementSchema`)، FE-053.
   *
   * دریافت سکه برای تسویه — همان فرمول `registerCoinSale` (بالاتر): مبلغ
   * تسویه‌شده تعداد × قیمت بازار؛ ارزش ذاتی/حباب مقدار یک سکه است.
   */
  http.post('/api/parties/:partyId/settlements/coins', async ({ request, params }) => {
    await delay(WRITE_DELAY_MS);

    const key = request.headers.get('Idempotency-Key');
    if (!key) {
      return mockMissingIdempotencyKey();
    }

    const cached = idempotencyCache.get(key);
    if (cached) return HttpResponse.json(cached, { status: 201 });

    const partyId = params['partyId'] as string;
    const party = partyList.find((p) => p.id === partyId);
    if (!party) return partyNotFound();

    const body = (await request.json()) as {
      coinTypeId: string;
      count: number;
      marketUnitPriceRial: string;
      quoteId: string;
      effectiveAt: string;
    };

    const fixture = COIN_TYPE_VERSIONS.find((c) => c.coinTypeId === body.coinTypeId);
    const quote = maznehQuoteHistory.find((q) => q.id === body.quoteId);
    if (!fixture || !quote) {
      return mockError('NOT_FOUND', !fixture ? 'نوع سکه‌ی انتخاب‌شده پیدا نشد' : 'مظنه‌ی انتخاب‌شده پیدا نشد');
    }

    const coin = toCoinType(fixture);
    const rate1000 = gramRate1000(BigInt(quote.amountRial));
    const marketUnitPriceRial = rial(BigInt(body.marketUnitPriceRial));
    const intrinsicValueRial = intrinsicValue(coin, rate1000);
    const bubbleRial = coin.isCentralBankMinted ? bubble(coin, marketUnitPriceRial, rate1000) : null;
    const settledRial = coinPositionValue(body.count, marketUnitPriceRial);

    // بدهکار کم می‌شود؛ رد شدن از صفر یعنی شخص بستانکار می‌شود — طبیعی است
    PARTY_RIAL_BALANCE[partyId] = (PARTY_RIAL_BALANCE[partyId] ?? 0n) - settledRial;

    // موجودی همان نوع سکه اضافه می‌شود — تسویه یعنی شخص سکه می‌دهد، فروشگاه می‌گیرد
    const existingBalance = COIN_BALANCE_ROWS.find((row) => row.itemId === body.coinTypeId);
    if (existingBalance) {
      existingBalance.quantity = (BigInt(existingBalance.quantity) + BigInt(body.count)).toString();
    } else {
      (COIN_BALANCE_ROWS as { itemType: 'COIN'; itemId: string; quantity: string }[]).push({
        itemType: 'COIN',
        itemId: body.coinTypeId,
        quantity: body.count.toString(),
      });
    }

    const result = {
      settlementId: crypto.randomUUID(),
      ledgerTransactionId: crypto.randomUUID(),
      inventoryMovementId: crypto.randomUUID(),
      coinTypeId: body.coinTypeId,
      count: body.count,
      settledRial: settledRial.toString(),
      intrinsicValueRial: intrinsicValueRial.toString(),
      bubbleRial: bubbleRial === null ? null : bubbleRial.toString(),
    };

    idempotencyCache.set(key, result);
    return HttpResponse.json(result, { status: 201 });
  }),

  /**
   * `POST /parties/:partyId/settlements/mixed` — قرارداد نهایی BE-048
   * (`createMixedSettlementSchema`/`mixedSettlementSchema`)، FE-054.
   *
   * یک درخواست، یک تراکنش: همه‌ی ردیف‌ها اول اعتبارسنجی می‌شوند (نوع سکه،
   * مظنه، سقف اعتبار `CREDIT`) و فقط اگر همه معتبر بودند موجودی/مانده
   * جابه‌جا می‌شود — نه نیمه‌کاره، دقیقاً «submit اتمیک».
   */
  http.post('/api/parties/:partyId/settlements/mixed', async ({ request, params }) => {
    await delay(WRITE_DELAY_MS);

    const key = request.headers.get('Idempotency-Key');
    if (!key) {
      return mockMissingIdempotencyKey();
    }

    const cached = idempotencyCache.get(key);
    if (cached) return HttpResponse.json(cached, { status: 201 });

    const partyId = params['partyId'] as string;
    const party = partyList.find((p) => p.id === partyId);
    if (!party) return partyNotFound();

    type MixedLineBody =
      | { type: 'RIAL'; amountRial: string }
      | { type: 'CREDIT'; amountRial: string }
      | { type: 'GOLD'; grossWeightMg: string; karat: number; quoteId: string }
      | { type: 'COIN'; coinTypeId: string; count: number; marketUnitPriceRial: string; quoteId: string };
    const body = (await request.json()) as { lines: MixedLineBody[]; effectiveAt: string };

    // گذر اول — فقط اعتبارسنجی و محاسبه، بدون هیچ جهش
    let totalSettledRial = 0n;
    let creditAppliedRial = 0n;
    const resultLines: Record<string, unknown>[] = [];
    const coinDeltas = new Map<string, bigint>();

    for (const line of body.lines) {
      if (line.type === 'RIAL') {
        const amount = BigInt(line.amountRial);
        totalSettledRial += amount;
        resultLines.push({ type: 'RIAL', settledRial: amount.toString() });
        continue;
      }
      if (line.type === 'CREDIT') {
        const amount = BigInt(line.amountRial);
        creditAppliedRial += amount;
        totalSettledRial += amount;
        resultLines.push({ type: 'CREDIT', settledRial: amount.toString() });
        continue;
      }
      if (line.type === 'GOLD') {
        const quote = maznehQuoteHistory.find((q) => q.id === line.quoteId);
        if (!quote) {
          return mockError('NOT_FOUND', 'مظنه‌ی انتخاب‌شده پیدا نشد');
        }
        const rate1000 = gramRate1000(BigInt(quote.amountRial));
        const pureWeightMg = toPureMg(grossMg(BigInt(line.grossWeightMg)), karat(line.karat));
        const settledRial = valueOfPure(pureWeightMg, rate1000);
        totalSettledRial += settledRial;
        resultLines.push({
          type: 'GOLD',
          inventoryMovementId: crypto.randomUUID(),
          pureWeightMg: pureWeightMg.toString(),
          settledRial: settledRial.toString(),
          goldRatePerGramRial: rate1000.toString(),
        });
        continue;
      }
      // COIN
      const fixture = COIN_TYPE_VERSIONS.find((c) => c.coinTypeId === line.coinTypeId);
      const quote = maznehQuoteHistory.find((q) => q.id === line.quoteId);
      if (!fixture || !quote) {
        return mockError('NOT_FOUND', !fixture ? 'نوع سکه‌ی انتخاب‌شده پیدا نشد' : 'مظنه‌ی انتخاب‌شده پیدا نشد');
      }
      const coin = toCoinType(fixture);
      const rate1000 = gramRate1000(BigInt(quote.amountRial));
      const marketUnitPriceRial = rial(BigInt(line.marketUnitPriceRial));
      const intrinsicValueRial = intrinsicValue(coin, rate1000);
      const bubbleRial = coin.isCentralBankMinted ? bubble(coin, marketUnitPriceRial, rate1000) : null;
      const settledRial = coinPositionValue(line.count, marketUnitPriceRial);
      totalSettledRial += settledRial;
      coinDeltas.set(line.coinTypeId, (coinDeltas.get(line.coinTypeId) ?? 0n) + BigInt(line.count));
      resultLines.push({
        type: 'COIN',
        inventoryMovementId: crypto.randomUUID(),
        coinTypeId: line.coinTypeId,
        count: line.count,
        settledRial: settledRial.toString(),
        intrinsicValueRial: intrinsicValueRial.toString(),
        bubbleRial: bubbleRial === null ? null : bubbleRial.toString(),
      });
    }

    // آینه‌ی MixedSettlementInsufficientCreditError واقعی
    const currentBalance = PARTY_RIAL_BALANCE[partyId] ?? 0n;
    const availableCreditRial = currentBalance < 0n ? -currentBalance : 0n;
    if (creditAppliedRial > availableCreditRial) {
      return mockError('BAD_REQUEST', 'مانده‌ی اعتباری شخص برای این ردیف کافی نیست');
    }

    // گذر دوم — همه معتبرند، حالا موجودی/مانده جابه‌جا می‌شود
    PARTY_RIAL_BALANCE[partyId] = currentBalance - totalSettledRial;
    for (const [coinTypeId, delta] of coinDeltas) {
      const existingBalance = COIN_BALANCE_ROWS.find((row) => row.itemId === coinTypeId);
      if (existingBalance) {
        existingBalance.quantity = (BigInt(existingBalance.quantity) + delta).toString();
      } else {
        (COIN_BALANCE_ROWS as { itemType: 'COIN'; itemId: string; quantity: string }[]).push({
          itemType: 'COIN',
          itemId: coinTypeId,
          quantity: delta.toString(),
        });
      }
    }

    const result = {
      settlementId: crypto.randomUUID(),
      ledgerTransactionId: crypto.randomUUID(),
      totalSettledRial: totalSettledRial.toString(),
      lines: resultLines,
    };

    idempotencyCache.set(key, result);
    return HttpResponse.json(result, { status: 201 });
  }),

  /**
   * `GET /inventory/jewelry-items` — قرارداد نهایی BE-026
   * (`jewelryItemQuerySchema`/`jewelryItemListSchema`): `search` کد **یا**
   * عنوان را می‌گردد، `active` رشته‌ی `"true"`/`"false"` است (نه boolean
   * خام — دقیقاً همان قرارداد واقعی)، `limit`/`offset` صفحه‌بندی
   * سرور-محور واقعی. بدون فیلتر عیار — قرارداد واقعی چنین چیزی ندارد
   * (`JewelryItemsPage` آن را خودش سمت کلاینت روی یک دسته‌ی بزرگ‌تر انجام
   * می‌دهد، نه اینجا).
   */
  http.get('/api/inventory/jewelry-items', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const params = new URL(request.url).searchParams;
    const search = params.get('search');
    const active = params.get('active');
    const limit = Number.parseInt(params.get('limit') ?? String(DEFAULT_PAGE_SIZE), 10);
    const offset = Number.parseInt(params.get('offset') ?? '0', 10);

    const filtered = jewelryItemList
      .filter((i) => (active === null ? true : i.active === (active === 'true')))
      .filter((i) => matchesQuery(i.title, search) || matchesQuery(i.code, search))
      .sort((a, b) => a.title.localeCompare(b.title, 'fa'));

    return HttpResponse.json({
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    });
  }),

  /**
   * `GET /inventory/jewelry-items/:id` — قرارداد نهایی BE-026
   * (`jewelryItemDetailQuerySchema`/`jewelryItemVersionSchema`). این mock
   * پارامتر اختیاری `at` (نسخه‌ی مؤثر در گذشته) را نادیده می‌گیرد و همیشه
   * نسخه‌ی باز جاری را برمی‌گرداند — تنها مصرف‌کننده‌ی امروز
   * (`SaleLinePricingDialog`، FE-043) هم فقط همین را می‌خواهد. الگوی
   * تطبیق `id` عیناً همان `PATCH` زیر است.
   */
  http.get('/api/inventory/jewelry-items/:id', async ({ params }) => {
    await delay(READ_DELAY_MS);
    const id = params['id'] as string;
    const found = jewelryItemList.find((i) => i.jewelryItemId === id || i.id === id);
    if (!found) {
      return mockError('NOT_FOUND', 'کالا پیدا نشد');
    }
    return HttpResponse.json(found);
  }),

  /** `POST /inventory/jewelry-items` — قرارداد نهایی BE-026 (`createJewelryItemSchema`). */
  http.post('/api/inventory/jewelry-items', async ({ request }) => {
    await delay(WRITE_DELAY_MS);

    const key = request.headers.get('Idempotency-Key');
    if (!key) {
      return mockMissingIdempotencyKey();
    }

    const cached = idempotencyCache.get(key);
    if (cached) return HttpResponse.json(cached, { status: 201 });

    const body = (await request.json()) as {
      code: string;
      title: string;
      grossWeightMg: string;
      karat: number;
      stoneWeightMg?: string;
      otherDeductionWeightMg?: string;
      wageType: JewelryItemVersion['wageType'];
      wageValue: string;
      validFrom?: string;
    };
    const now = new Date().toISOString();
    jewelryItemVersionCounter += 1;
    const created: JewelryItemVersion = {
      id: `b2000000-0000-4000-8000-${String(jewelryItemVersionCounter).padStart(12, '0')}`,
      jewelryItemId: `b1000000-0000-4000-8000-${String(jewelryItemVersionCounter).padStart(12, '0')}`,
      code: body.code,
      title: body.title,
      grossWeightMg: body.grossWeightMg,
      karat: body.karat,
      stoneWeightMg: body.stoneWeightMg ?? '0',
      otherDeductionWeightMg: body.otherDeductionWeightMg ?? '0',
      wageType: body.wageType,
      wageValue: body.wageValue,
      validFrom: body.validFrom ?? now,
      validTo: null,
      version: 1,
      active: true,
    };
    jewelryItemList = [...jewelryItemList, created];
    idempotencyCache.set(key, created);
    return HttpResponse.json(created, { status: 201 });
  }),

  /**
   * `PATCH /inventory/jewelry-items/:id` — قرارداد نهایی BE-026
   * (`updateJewelryItemSchema`). سرور واقعی اینجا تصمیم می‌گیرد نسخه‌ی
   * تازه بسازد یا فقط عنوان را جا‌به‌جا کند؛ این mock همیشه به‌روزرسانی
   * درجا انجام می‌دهد چون هیچ صفحه‌ای امروز به تاریخچه‌ی نسخه‌ها نیاز ندارد
   * — رفتار قابل‌مشاهده از بیرون (پاسخ PATCH) یکسان می‌ماند.
   */
  http.patch('/api/inventory/jewelry-items/:id', async ({ request, params }) => {
    await delay(WRITE_DELAY_MS);

    const key = request.headers.get('Idempotency-Key');
    if (!key) {
      return mockMissingIdempotencyKey();
    }

    const cached = idempotencyCache.get(key);
    if (cached) return HttpResponse.json(cached, { status: 200 });

    const id = params['id'] as string;
    const existing = jewelryItemList.find((i) => i.jewelryItemId === id || i.id === id);
    if (!existing) {
      return mockError('NOT_FOUND', 'کالا پیدا نشد');
    }

    const body = (await request.json()) as {
      title?: string;
      grossWeightMg?: string;
      karat?: number;
      stoneWeightMg?: string;
      otherDeductionWeightMg?: string;
      wageType?: JewelryItemVersion['wageType'];
      wageValue?: string;
    };
    const updated: JewelryItemVersion = {
      ...existing,
      ...(body.title !== undefined && { title: body.title }),
      ...(body.grossWeightMg !== undefined && { grossWeightMg: body.grossWeightMg }),
      ...(body.karat !== undefined && { karat: body.karat }),
      ...(body.stoneWeightMg !== undefined && { stoneWeightMg: body.stoneWeightMg }),
      ...(body.otherDeductionWeightMg !== undefined && {
        otherDeductionWeightMg: body.otherDeductionWeightMg,
      }),
      ...(body.wageType !== undefined && { wageType: body.wageType }),
      ...(body.wageValue !== undefined && { wageValue: body.wageValue }),
    };
    jewelryItemList = jewelryItemList.map((i) => (i.jewelryItemId === id || i.id === id ? updated : i));
    idempotencyCache.set(key, updated);
    return HttpResponse.json(updated, { status: 200 });
  }),

  /**
   * `GET /inventory/coin-types` — FE-038 (endpoint واقعی FE-081). نسخه‌ی جاری
   * هر نوع از تاریخچه‌ی mock که POSTهای زیر به‌روزش می‌کنند.
   */
  http.get('/api/inventory/coin-types', async () => {
    await delay(READ_DELAY_MS);
    return HttpResponse.json(mockCoinTypeHistory.map((type) => type.versions[0]));
  }),

  /**
   * `GET /inventory/coin-types/history` و دو POST انواع سکه — FE-081، همان
   * قرارداد `CoinTypesController`. نقش در mock سنجیده نمی‌شود (سرور `@Roles` دارد).
   */
  http.get('/api/inventory/coin-types/history', async () => {
    await delay(READ_DELAY_MS);
    const types: CoinTypeHistory[] = mockCoinTypeHistory.map((type) => ({ ...type, versions: [...type.versions] }));
    return HttpResponse.json({ types });
  }),

  http.post('/api/inventory/coin-types', async ({ request }) => {
    await delay(WRITE_DELAY_MS);
    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey) return mockMissingIdempotencyKey();
    const cached = idempotencyCache.get(idempotencyKey);
    if (cached) return HttpResponse.json(cached, { status: 201 });

    const parsed = createCoinTypeSchema.safeParse(await request.json());
    if (!parsed.success) return mockValidationError(parsed.error);
    if (mockCoinTypeHistory.some((type) => type.code === parsed.data.code)) {
      return mockError('CONFLICT', `کد «${parsed.data.code}» قبلاً ثبت شده است`);
    }
    const coinTypeId = crypto.randomUUID();
    const created = mockCoinTypeVersion(coinTypeId, parsed.data.code, 1, parsed.data);
    mockCoinTypeHistory.push({ coinTypeId, code: parsed.data.code, versions: [created] });
    idempotencyCache.set(idempotencyKey, created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.post('/api/inventory/coin-types/:coinTypeId/versions', async ({ request, params }) => {
    await delay(WRITE_DELAY_MS);
    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey) return mockMissingIdempotencyKey();
    const cached = idempotencyCache.get(idempotencyKey);
    if (cached) return HttpResponse.json(cached, { status: 201 });

    const type = mockCoinTypeHistory.find((candidate) => candidate.coinTypeId === params.coinTypeId);
    if (!type) {
      return mockError('NOT_FOUND', 'نوع سکه پیدا نشد');
    }
    const parsed = createCoinTypeVersionSchema.safeParse(await request.json());
    if (!parsed.success) return mockValidationError(parsed.error);

    const previous = type.versions[0]!;
    const created = mockCoinTypeVersion(type.coinTypeId, type.code, previous.version + 1, parsed.data);
    type.versions = [created, { ...previous, validTo: created.validFrom }, ...type.versions.slice(1)];
    idempotencyCache.set(idempotencyKey, created);
    return HttpResponse.json(created, { status: 201 });
  }),

  /**
   * `GET /inventory/balances` — قرارداد نهایی BE-028. فقط `itemType=COIN`
   * پیاده‌سازی شده چون فعلاً تنها مصرف‌کننده `CoinInventoryPage` (FE-038)
   * است؛ سایر itemTypeها آرایه‌ی خالی می‌گیرند تا شکل واقعی حفظ شود.
   */
  http.get('/api/inventory/balances', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const itemType = new URL(request.url).searchParams.get('itemType');
    if (itemType === 'COIN') return HttpResponse.json(COIN_BALANCE_ROWS);
    if (itemType === 'JEWELRY') return HttpResponse.json(JEWELRY_BALANCE_ROWS);
    return HttpResponse.json([]);
  }),

  /**
   * `POST /inventory/opening-balances` — قرارداد نهایی BE-028 (FE-039).
   * بدون endpoint اصلاح یا حذف — سند واقعی هم همین‌طور است (بخش ۲-۷
   * CLAUDE.md، دفتر کل append-only)، پس این mock هم چیزی برای «ویرایش»
   * ندارد؛ فقط ثبت و پاسخ.
   */
  http.post('/api/inventory/opening-balances', async ({ request }) => {
    await delay(WRITE_DELAY_MS);

    const key = request.headers.get('Idempotency-Key');
    if (!key) {
      return mockMissingIdempotencyKey();
    }

    const cached = idempotencyCache.get(key);
    if (cached) return HttpResponse.json(cached, { status: 201 });

    const body = (await request.json()) as { effectiveAt: string; description: string };
    const now = new Date().toISOString();
    const created = {
      id: crypto.randomUUID(),
      ledgerTransactionId: crypto.randomUUID(),
      effectiveAt: body.effectiveAt,
      description: body.description,
      createdAt: now,
    };
    idempotencyCache.set(key, created);
    return HttpResponse.json(created, { status: 201 });
  }),

  /**
   * `GET`/`POST /settings/general` — FE-080، شکل `generalSettingsSchema` واقعی.
   * POST با همان `updateGeneralSettingSchema` قرارداد اعتبارسنجی می‌شود و نسخه‌ی
   * تازه می‌سازد. نقش در mock سنجیده نمی‌شود (سرور واقعی `@Roles` دارد).
   */
  http.get('/api/settings/general', async () => {
    await delay(READ_DELAY_MS);
    return HttpResponse.json({
      settings: [...mockGeneralSettings.entries()].map(([key, setting]) => ({ key, ...setting })),
    });
  }),

  http.post('/api/settings/general', async ({ request }) => {
    await delay(WRITE_DELAY_MS);
    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey) {
      return mockMissingIdempotencyKey();
    }
    const cached = idempotencyCache.get(idempotencyKey);
    if (cached) return HttpResponse.json(cached, { status: 201 });

    const parsed = updateGeneralSettingSchema.safeParse(await request.json());
    if (!parsed.success) {
      return mockValidationError(parsed.error);
    }
    const previous = mockGeneralSettings.get(parsed.data.key);
    const next = {
      value: parsed.data.value,
      version: (previous?.version ?? 0) + 1,
      validFrom: new Date().toISOString(),
      createdBy: null,
    };
    mockGeneralSettings.set(parsed.data.key, next);
    const body = { key: parsed.data.key, ...next };
    idempotencyCache.set(idempotencyKey, body);
    return HttpResponse.json(body, { status: 201 });
  }),

  /** `GET /reporting/profit` — قرارداد نهایی BE-060 (`profitReportSchema`، FE-075). */
  http.get('/api/reporting/profit', async ({ request }) => {
    await delay(READ_DELAY_MS);
    // همان schema ِ query که `ZodValidationPipe` سرور اجرا می‌کند — نه بازنویسی دستی قاعده‌ی بازه.
    const query = profitReportQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return mockValidationError(query.error);
    return HttpResponse.json(ledgerProfitReportFor(query.data.from ?? null, query.data.to ?? null));
  }),

  /** `GET /reporting/dashboard` — قرارداد نهایی BE-062ایش (FE-040). */
  http.get('/api/reporting/dashboard', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const displayUnit = new URL(request.url).searchParams.get('displayUnit') === 'RIAL' ? 'RIAL' : 'GOLD';
    return HttpResponse.json(dashboardFor(displayUnit));
  }),

  /**
   * `GET /inventory/movements/recent` — FE-040؛ سرور FE-106b
   * (`RecentInventoryMovementsController`).
   */
  http.get('/api/inventory/movements/recent', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const limit = Number.parseInt(new URL(request.url).searchParams.get('limit') ?? '5', 10);
    return HttpResponse.json(RECENT_INVENTORY_MOVEMENTS.slice(0, limit));
  }),

  http.get('/api/transactions/recent', async ({ request }) => {
    await delay(READ_DELAY_MS);
    // پارامتر شمارشی است، نه مالی — تجزیه‌ی صحیح کافی است
    const limit = Number.parseInt(new URL(request.url).searchParams.get('limit') ?? '5', 10);
    return HttpResponse.json({ items: recentTransactions.slice(0, limit) });
  }),

  /**
   * `GET /sales/invoices` — فهرست FE-064؛ سرور FE-106b (`SalesInvoiceReadsController`)
   * با همان قرارداد مشترک `salesInvoiceListSchema`. پیش‌نویس‌ها و فیلترها مثل سرور.
   */
  http.get('/api/sales/invoices', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const params = new URL(request.url).searchParams;
    const requestedLimit = Number.parseInt(params.get('limit') ?? String(DEFAULT_PAGE_SIZE), 10);
    const requestedOffset = Number.parseInt(params.get('offset') ?? '0', 10);
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE;
    const offset = Number.isFinite(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;
    const invoiceNumber = params.get('invoiceNumber');
    const partySearch = params.get('partySearch');
    const status = params.get('status');
    const from = params.get('from');
    const to = params.get('to');
    const fromTime = from ? new Date(from).getTime() : null;
    const toTime = to ? new Date(to).getTime() : null;

    const filtered = salesInvoiceList.filter((invoice) => {
      const numberMatches =
        !invoiceNumber ||
        (invoice.invoiceNumber !== null &&
          `${invoice.invoicePeriod}-${invoice.invoiceNumber}`.includes(invoiceNumber));
      const partyMatches = matchesQuery(invoice.party.displayName, partySearch);
      const statusMatches = !status || invoice.status === status;
      const occurredAt = new Date(invoice.occurredAt).getTime();
      const fromMatches = fromTime === null || occurredAt >= fromTime;
      const toMatches = toTime === null || occurredAt <= toTime;
      return numberMatches && partyMatches && statusMatches && fromMatches && toMatches;
    });

    return HttpResponse.json({
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    });
  }),

  /**
   * `POST /sales/invoices/jewelry` — قرارداد نهایی BE-041
   * (`createJewelryCashSaleSchema`/`jewelryCashSaleSchema`)، FE-045.
   *
   * جایگزین mock منسوخ `POST /api/invoices` شد (آرایه‌ای از خطوط + مظنه‌ی
   * خام) که هیچ‌وقت شکل بک‌اند واقعی را نداشت.
   *
   * مثل سرور واقعی: بدنه فقط ارجاع می‌فرستد (`partyId`, `jewelryItemId`,
   * `quoteId`) و **قیمت اینجا محاسبه می‌شود**، از روی نسخه‌ی کالا و همان
   * مظنه‌ای که `quoteId` نشان می‌دهد — نه از هیچ عددی که کلاینت فرستاده.
   * شماره‌ی فاکتور هم بدون شکاف از یک شمارنده می‌آید.
   */
  http.post('/api/sales/invoices/jewelry', ({ request }) => registerJewelrySale(request, 'CASH')),

  /**
   * `POST /sales/invoices/jewelry/credit` — قرارداد نهایی BE-042
   * (`createJewelryCreditSaleSchema`/`jewelryCreditSaleSchema`)، FE-047.
   *
   * همان جریان نقدی، فقط `paidRial` می‌گیرد و `receivableRial`
   * برمی‌گرداند — **سرور** تفریق را انجام می‌دهد، نه کلاینت. مانده هرگز
   * منفی نمی‌شود، چون قرارداد `nonNegativeBigIntStringSchema` است.
   */
  http.post('/api/sales/invoices/jewelry/credit', ({ request }) =>
    registerJewelrySale(request, 'CREDIT'),
  ),

  /**
   * `POST /sales/invoices/coins` — قرارداد نهایی BE-043
   * (`createCoinSaleSchema`/`coinSaleSchema`)، FE-048.
   *
   * تعداد `integer` می‌ماند (`body.count`)، هرگز به وزن تبدیل نمی‌شود.
   * `intrinsicValueRial`/`bubbleRial` مقدار **یک سکه** است؛ `payableRial`
   * تعداد × قیمت بازار. `bubbleRial` فقط برای نوع بانک‌مرکزی مقدار دارد.
   */
  http.post('/api/sales/invoices/coins', ({ request }) => registerCoinSale(request)),

  /**
   * projection تجمیعی جزئیات فاکتور — FE-065. تمام نرخ‌ها، پرداخت‌ها و
   * تنظیمات از snapshot خود سند می‌آیند، نه وضعیت زنده‌ی فروشگاه.
   */
  http.get('/api/sales/invoices/:invoiceId/detail', async ({ params }) => {
    await delay(READ_DELAY_MS);
    const found = salesInvoiceDetails.get(String(params.invoiceId));
    if (!found) {
      return mockError('NOT_FOUND', 'فاکتور مورد نظر پیدا نشد');
    }
    return HttpResponse.json(found);
  }),

  /** Sample server-owned preflight response; the browser never derives authorization. */
  http.get('/api/sales/invoices/:invoiceId/amendment-policy', async ({ params }) => {
    await delay(READ_DELAY_MS);
    const found = salesInvoiceDetails.get(String(params.invoiceId));
    if (!found) {
      return mockError('NOT_FOUND', 'فاکتور مورد نظر پیدا نشد');
    }
    return HttpResponse.json(amendmentPolicyFor(found));
  }),

  /** دانلود آزمایشی همان endpoint واقعی PDF با نام فایل شماره فاکتور. */
  http.get('/api/sales/invoices/:invoiceId/pdf', async ({ params }) => {
    await delay(READ_DELAY_MS);
    const found = salesInvoiceDetails.get(String(params.invoiceId));
    if (!found || found.invoiceNumber === null || found.invoicePeriod === null || found.status !== 'FINALIZED') {
      return mockError('NOT_FOUND', 'نسخه PDF این فاکتور در دسترس نیست');
    }
    const content = new Blob(
      [`%PDF-1.4\n% Gold Accounting invoice ${invoiceNumberLabel(found.invoicePeriod, found.invoiceNumber)}\n%%EOF`],
      { type: 'application/pdf' },
    );
    return new HttpResponse(content, {
      headers: {
        'Content-Type': 'application/pdf',
        // FE-098: بدون Content-Disposition — مثل سرور (`pdf-response.ts`)
        'X-File-Name': encodeURIComponent(`invoice-${invoiceNumberLabel(found.invoicePeriod, found.invoiceNumber)}.pdf`),
      },
    });
  }),

  /**
   * `GET /purchase/second-hand/:purchaseId/pdf` و `GET /parties/:id/statement/pdf`
   * — FE-078. مثل سرور واقعی هر دو از invoice exporter مشترک نام
   * `invoice-<شناسه>.pdf` می‌گیرند (نام گویا را فرانت می‌سازد).
   */
  http.get('/api/purchase/second-hand/:purchaseId/pdf', async ({ params }) => {
    await delay(READ_DELAY_MS);
    const purchaseId = String(params.purchaseId);
    if (!mockSecondHandPurchaseIds.has(purchaseId)) {
      return mockError('NOT_FOUND', 'خرید دست‌دوم پیدا نشد');
    }
    return new HttpResponse(new Blob([`%PDF-1.4
% purchase ${purchaseId}
%%EOF`], { type: 'application/pdf' }), {
      headers: {
        'Content-Type': 'application/pdf',
        'X-File-Name': encodeURIComponent(`invoice-${purchaseId}.pdf`),
      },
    });
  }),

  http.get('/api/parties/:id/statement/pdf', async ({ params }) => {
    await delay(READ_DELAY_MS);
    const id = String(params.id);
    if (!partyList.some((party) => party.id === id)) return partyNotFound();
    return new HttpResponse(new Blob([`%PDF-1.4
% statement ${id}
%%EOF`], { type: 'application/pdf' }), {
      headers: {
        'Content-Type': 'application/pdf',
        'X-File-Name': encodeURIComponent(`invoice-${id}.pdf`),
      },
    });
  }),

  /**
   * `GET /sales/invoices/:invoiceId/versions` — قرارداد نهایی BE-043
   * (`salesInvoiceVersionHistorySchema`)، FE-046.
   *
   * فقط فاکتورهایی را می‌شناسد که در همین نشست ثبت شده‌اند — دقیقاً همان
   * چیزی که رسید لازم دارد. فهرست فاکتورهای قدیمی کار FE-064/FE-065 است.
   */
  http.get('/api/sales/invoices/:invoiceId/versions', async ({ params }) => {
    await delay(READ_DELAY_MS);

    const found = salesInvoiceVersions.get(String(params.invoiceId));
    if (!found) {
      return mockError('NOT_FOUND', 'فاکتور مورد نظر پیدا نشد');
    }
    return HttpResponse.json(found);
  }),

  http.get('/api/sales/invoices/:invoiceId/amendments', async ({ params }) => {
    await delay(READ_DELAY_MS);
    const found = salesInvoiceVersions.get(String(params.invoiceId));
    if (!found) {
      return mockError('NOT_FOUND', 'فاکتور مورد نظر پیدا نشد');
    }
    const amendments: SalesInvoiceAmendmentHistory['amendments'] = found.versions.flatMap((version, index) => {
      const before = found.versions[index - 1];
      if (!before || version.reason === null) return [];
      return [{
        version: version.version,
        reason: version.reason,
        reasonDetail: version.reasonDetail,
        actor: version.actor,
        createdAt: version.createdAt,
        changes: {
          pureWeightMg: {
            before: before.pureWeightMg,
            after: version.pureWeightMg,
            delta: historyDifference(before.pureWeightMg, version.pureWeightMg),
          },
          payableRial: {
            before: before.payableRial,
            after: version.payableRial,
            delta: historyDifference(before.payableRial, version.payableRial),
          },
          karat: { before: before.karat, after: version.karat },
        },
        ledgerEffects: version.ledgerEffects,
        inventoryEffects: version.inventoryEffects,
      }];
    });
    return HttpResponse.json({ invoiceId: found.invoiceId, invoiceNumber: found.invoiceNumber, invoicePeriod: found.invoicePeriod, amendments } satisfies SalesInvoiceAmendmentHistory);
  }),

  /**
   * `POST /sales/invoices/:invoiceId/b2c-buyback/preview` — BE (`b2c-buybacks.controller.ts`)، FE-093.
   * مقایسه‌ی بی‌اثر: هیچ سند، پرداخت یا حرکت موجودی ثبت نمی‌شود.
   */
  http.post('/api/sales/invoices/:invoiceId/b2c-buyback/preview', async ({ request, params }) => {
    await delay(READ_DELAY_MS);
    const body = previewB2cBuybackSchema.parse(await request.json());
    const original = originalJewelrySale(String(params.invoiceId));
    if (!original.ok) return original.response;
    const quote = maznehQuoteHistory.find((candidate) => candidate.id === body.quoteId);
    if (!quote) return mockError('BAD_REQUEST', 'مظنه‌ی انتخاب‌شده پیدا نشد');
    try {
      const { today, breakdown } = b2cBuybackComparison(original, body, quote);
      return HttpResponse.json({
        sourceInvoiceId: original.detail.id,
        original: {
          effectiveAt: original.detail.occurredAt,
          quoteAmountRial: original.quote.amountRial,
          quoteObservedAt: original.quote.observedAt,
          goldRatePerGramRial: original.calculation.goldRatePerGramRial.toString(),
          purchaseAmountRial: original.purchaseAmountRial.toString(),
        },
        today: {
          effectiveAt: body.effectiveAt,
          quoteAmountRial: quote.amountRial,
          quoteObservedAt: quote.observedAt,
          goldRatePerGramRial: today.goldRatePerGramRial.toString(),
          purchaseAmountRial: today.finalAmountRial.toString(),
        },
        breakdown,
      });
    } catch {
      return mockError('BAD_REQUEST', 'محاسبه خرید نامعتبر است');
    }
  }),

  /** `POST /sales/invoices/:invoiceId/b2c-buyback` — خرید دست‌دوم تازه که فاکتور فقط مرجع آن است. */
  http.post('/api/sales/invoices/:invoiceId/b2c-buyback', async ({ request, params }) => {
    await delay(WRITE_DELAY_MS);
    const cacheKey = `b2c-buyback:${request.headers.get('Idempotency-Key') ?? ''}`;
    const cached = idempotencyCache.get(cacheKey);
    if (cached) return HttpResponse.json(cached, { status: 201 });
    const body = createB2cBuybackSchema.parse(await request.json());
    const original = originalJewelrySale(String(params.invoiceId));
    if (!original.ok) return original.response;
    const quote = maznehQuoteHistory.find((candidate) => candidate.id === body.quoteId);
    if (!quote) return mockError('BAD_REQUEST', 'مظنه‌ی انتخاب‌شده پیدا نشد');
    try {
      const { today, breakdown } = b2cBuybackComparison(original, body, quote);
      const paid = BigInt(body.paidRial);
      if (paid > today.finalAmountRial) return mockError('BAD_REQUEST', 'پرداخت بیشتر از مبلغ خرید است');
      const result = {
        secondHandPurchaseId: crypto.randomUUID(),
        ledgerTransactionId: crypto.randomUUID(),
        inventoryMovementId: crypto.randomUUID(),
        sourceInvoiceId: original.detail.id,
        pureWeightMg: today.pureWeightMg.toString(),
        goldRatePerGramRial: today.goldRatePerGramRial.toString(),
        paidRial: paid.toString(),
        payableRial: (today.finalAmountRial - paid).toString(),
        breakdown,
      };
      mockSecondHandPurchaseIds.add(result.secondHandPurchaseId);
      postPartyRial(original.detail.party.id, -(today.finalAmountRial - paid));
      idempotencyCache.set(cacheKey, result);
      return HttpResponse.json(result, { status: 201 });
    } catch {
      return mockError('BAD_REQUEST', 'محاسبه خرید نامعتبر است');
    }
  }),

  /**
   * `POST /sales/invoices/:invoiceId/amend` — نسخه‌ی تازه، نه ویرایش (قاعده‌ی ۲-۷). قیمت با
   * مظنه‌ی قفل‌شده‌ی خود فاکتور بازمحاسبه می‌شود؛ هیچ عددی از کلاینت جز واقعیت‌های منبع پذیرفته نمی‌شود.
   */
  http.post('/api/sales/invoices/:invoiceId/amend', async ({ request, params }) => {
    await delay(WRITE_DELAY_MS);
    const cacheKey = `amend:${request.headers.get('Idempotency-Key') ?? ''}`;
    const cached = idempotencyCache.get(cacheKey);
    if (cached) return HttpResponse.json(cached, { status: 201 });
    const body = amendSalesInvoiceSchema.parse(await request.json());
    const detail = salesInvoiceDetails.get(String(params.invoiceId));
    const history = salesInvoiceVersions.get(String(params.invoiceId));
    if (!detail || !history) return mockError('NOT_FOUND', 'فاکتور مورد نظر پیدا نشد');
    const policy = amendmentPolicyFor(detail);
    if (!policy.allowed || detail.quoteSnapshot === null || detail.invoiceNumber === null || detail.invoicePeriod === null) {
      return mockError('BAD_REQUEST', 'این فاکتور در وضعیت فعلی قابل اصلاح نیست');
    }
    const party = partyList.find((candidate) => candidate.id === body.partyId);
    if (!party) return mockError('NOT_FOUND', 'شخص مورد نظر پیدا نشد');

    let line: { itemId: string; title: string; quantity: string; pureWeightMg: string | null; karat: number; payableRial: bigint };
    if (body.item.itemType === 'JEWELRY') {
      const jewelry = findJewelryVersion(body.item.jewelryItemId);
      if (!jewelry) return mockError('NOT_FOUND', 'کالای انتخاب‌شده پیدا نشد');
      const calc = priceJewelryFromVersion(jewelry, BigInt(detail.quoteSnapshot.amountRial));
      line = { itemId: jewelry.jewelryItemId, title: jewelry.title, quantity: '1', pureWeightMg: calc.pureWeightMg.toString(), karat: jewelry.karat, payableRial: calc.payableRial };
    } else {
      const coinItem = body.item;
      const fixture = COIN_TYPE_VERSIONS.find((candidate) => candidate.coinTypeId === coinItem.coinTypeId);
      if (!fixture) return mockError('NOT_FOUND', 'نوع سکه پیدا نشد');
      line = { itemId: fixture.coinTypeId, title: fixture.title, quantity: String(coinItem.count), pureWeightMg: null, karat: fixture.karat, payableRial: coinPositionValue(coinItem.count, rial(BigInt(coinItem.marketUnitPriceRial))) };
    }
    const paid = BigInt(body.item.paidRial);
    if (paid > line.payableRial) return mockError('BAD_REQUEST', 'مبلغ پرداختی نمی‌تواند از مبلغ قابل‌پرداخت بیشتر باشد');
    const receivable = line.payableRial - paid;
    const version = detail.currentVersion + 1;
    // نسخه‌ی تازه جایگزین اثر نسخه‌ی قبلی می‌شود: طلب قبلی از شخص قبلی برمی‌گردد، طلب تازه روی شخص تازه می‌نشیند
    postPartyRial(detail.party.id, -BigInt(detail.versions[detail.versions.length - 1]!.receivableRial));
    postPartyRial(party.id, receivable);
    const createdAt = new Date().toISOString();
    const actor = { id: 'c1000000-0000-4000-8000-000000000002', displayName: 'مدیر فروشگاه' };
    const item = { itemType: body.item.itemType, itemId: line.itemId, quantity: line.quantity, pureWeightMg: line.pureWeightMg, karat: line.karat };

    salesInvoiceDetails.set(detail.id, {
      ...detail,
      currentVersion: version,
      party: { id: party.id, displayName: party.displayName, type: party.type, status: party.status },
      versions: [
        ...detail.versions,
        {
          version,
          reason: body.reason,
          reasonDetail: body.reasonDetail ?? null,
          actor,
          createdAt,
          payableRial: line.payableRial.toString(),
          paidRial: paid.toString(),
          receivableRial: receivable.toString(),
          pureWeightMg: line.pureWeightMg,
          items: [{ ...item, title: line.title, payableRial: line.payableRial.toString() }],
          settingsSnapshot: detail.versions[detail.versions.length - 1]!.settingsSnapshot,
          ledgerSummary: { transactionCount: 1, entryCount: receivable === 0n ? 4 : 5, balanced: true },
        },
      ],
    });
    salesInvoiceVersions.set(detail.id, {
      ...history,
      versions: [
        ...history.versions,
        {
          version,
          reason: body.reason,
          reasonDetail: body.reasonDetail ?? null,
          partyId: party.id,
          actor,
          createdAt,
          payableRial: line.payableRial.toString(),
          pureWeightMg: line.pureWeightMg,
          karat: line.karat,
          items: [item],
          totalsSnapshot: {
            payableRial: line.payableRial.toString(),
            paidRial: paid.toString(),
            receivableRial: receivable.toString(),
            pureWeightMg: line.pureWeightMg,
          },
          settingsSnapshot: history.versions[history.versions.length - 1]!.settingsSnapshot,
          ledgerEffects: [],
          inventoryEffects: [],
        },
      ],
    });
    salesInvoiceList = salesInvoiceList.map((row) =>
      row.id === detail.id
        ? { ...row, currentVersion: version, payableRial: line.payableRial.toString(), party: { id: party.id, displayName: party.displayName } }
        : row,
    );

    const result = {
      invoiceId: detail.id,
      invoiceNumber: detail.invoiceNumber,
      invoicePeriod: detail.invoicePeriod,
      version,
      payableRial: line.payableRial.toString(),
      receivableRial: receivable.toString(),
      ledgerTransactionId: crypto.randomUUID(),
      inventoryMovementIds: [crypto.randomUUID(), crypto.randomUUID()],
    };
    idempotencyCache.set(cacheKey, result);
    return HttpResponse.json(result, { status: 201 });
  }),
];
