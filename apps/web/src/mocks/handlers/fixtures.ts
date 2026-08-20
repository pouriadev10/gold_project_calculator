import {
  dualFromPure,
  dualFromRial,
  gramRate,
  gramRate1000,
  karat,
  mulDivHalfUp,
} from '@gold/core-calc';
import type { Party } from '@/api/contracts';

/**
 * داده‌ی ساختگی مشترک همه‌ی handlerها.
 *
 * مقادیر با `core-calc` محاسبه می‌شوند، نه دستی نوشته — یعنی داده‌ی
 * ساختگی هم با همان موتوری ساخته می‌شود که سرور واقعی استفاده خواهد کرد.
 * اگر فرمولی عوض شود، mock هم همراهش عوض می‌شود و ناسازگاری پنهان نمی‌ماند.
 */

// TODO(real-data): از فید مظنه یا ورود دستی کاربر
export const MAZNEH_RIAL = 480_000_000n;
export const RATE_1000 = gramRate1000(MAZNEH_RIAL);
export const FETCHED_AT = new Date('2026-07-30T09:12:00Z');

/** میلی‌گرم — بدون هیچ ضرب شناوری، حتی در داده‌ی ساختگی */
const mg = (milligrams: number): bigint => BigInt(milligrams);

const DAY_MS = 24 * 60 * 60 * 1000;

/** سریالایز کردن مبلغ دومقیاسه به شکل روی سیم (رشته، نه عدد) */
export function dualToWire(pureMg: bigint) {
  const dual = dualFromPure(pureMg, RATE_1000);
  return {
    rial: dual.rial.toString(),
    pureMg: dual.pureMg.toString(),
    rate1000: dual.rate1000.toString(),
  };
}

/** همان، ولی از سمت ریال — برای مبالغی که ذاتاً ریالی محاسبه شده‌اند. */
export function rialToWire(rial: bigint) {
  const dual = dualFromRial(rial, RATE_1000);
  return {
    rial: dual.rial.toString(),
    pureMg: dual.pureMg.toString(),
    rate1000: dual.rate1000.toString(),
  };
}

/* ── نرخ‌ها ────────────────────────────────────────────────── */

/** عیار ۱۰۰۰ لازم است چون مبنای ارزش ذاتی سکه و قیمت شمش است */
const COMMON_KARATS = [705, 740, 750, 900, 925, 995, 1000] as const;

export const gramRates = COMMON_KARATS.map((k) => ({
  karat: k,
  rateRial: gramRate(MAZNEH_RIAL, karat(k)).toString(),
}));

// TODO(real-data): از جدول نسخه‌دار coin_type
export const coins = [
  { id: 'bahar-azadi-new', label: 'تمام بهار آزادی', grossMg: 8133, karat: 900, market: 1_250_000_000n },
  { id: 'nim', label: 'نیم سکه', grossMg: 4066, karat: 900, market: 640_000_000n },
  { id: 'rob', label: 'ربع سکه', grossMg: 2033, karat: 900, market: 380_000_000n },
  { id: 'gerami', label: 'سکه گرمی', grossMg: 1016, karat: 900, market: 230_000_000n },
].map((c) => ({
  id: c.id,
  label: c.label,
  grossMg: c.grossMg.toString(),
  karat: c.karat,
  marketPriceRial: c.market.toString(),
}));

/* ── اشخاص ────────────────────────────────────────────────── */

// TODO(real-data): از ماژول parties
// شکل partyRecords دقیقاً partySchema واقعی (@gold/contracts) است.
// مانده بخشی از آن شکل نیست (BE-056 هنوز نیامده)، پس `mg` فقط در همین
// فایل برای ساخت balanceSummary نگه داشته می‌شود، نه در پاسخ /api/parties.
const NOW = '2026-07-30T09:00:00+00:00';

const parties = [
  { id: 'a1000000-0000-4000-8000-000000000001', displayName: 'حسین مرادی', type: 'CONSUMER', nationalId: null, mobile: '09121234567', mg: 412_500, status: 'ACTIVE' },
  { id: 'a1000000-0000-4000-8000-000000000002', displayName: 'زهرا کریمی', type: 'CONSUMER', nationalId: null, mobile: '09127654321', mg: -86_000, status: 'ACTIVE' },
  { id: 'a1000000-0000-4000-8000-000000000003', displayName: 'مهدی صادقی', type: 'BUSINESS', nationalId: '0079123456', mobile: '09351112233', mg: 268_000, status: 'ACTIVE' },
  { id: 'a1000000-0000-4000-8000-000000000004', displayName: 'فاطمه یوسفی', type: 'CONSUMER', nationalId: null, mobile: null, mg: -154_300, status: 'ACTIVE' },
  { id: 'a1000000-0000-4000-8000-000000000005', displayName: 'علی‌رضا نجفی', type: 'BUSINESS', nationalId: null, mobile: '09193334455', mg: 559_000, status: 'ACTIVE' },
  { id: 'a1000000-0000-4000-8000-000000000006', displayName: 'سمیه احمدی', type: 'CONSUMER', nationalId: null, mobile: null, mg: -32_450, status: 'ACTIVE' },
  { id: 'a1000000-0000-4000-8000-000000000007', displayName: 'رضا کاظمی', type: 'BUSINESS', nationalId: null, mobile: '09141239876', mg: 91_200, status: 'ACTIVE' },
  { id: 'a1000000-0000-4000-8000-000000000008', displayName: 'آرش تقوی', type: 'CONSUMER', nationalId: null, mobile: '09120001122', mg: 75_000, status: 'ACTIVE' },
  { id: 'a1000000-0000-4000-8000-000000000009', displayName: 'لیلا موسوی', type: 'CONSUMER', nationalId: null, mobile: null, mg: -12_800, status: 'ACTIVE' },
  { id: 'a1000000-0000-4000-8000-000000000010', displayName: 'بابک شریفی', type: 'BUSINESS', nationalId: '0068889991', mobile: '09353334455', mg: 340_500, status: 'ACTIVE' },
  { id: 'a1000000-0000-4000-8000-000000000011', displayName: 'نگار حیدری', type: 'CONSUMER', nationalId: null, mobile: '09190009988', mg: 0, status: 'INACTIVE' },
  { id: 'a1000000-0000-4000-8000-000000000012', displayName: 'کامران فرهادی', type: 'CONSUMER', nationalId: null, mobile: '09121237788', mg: -5_600, status: 'ACTIVE' },
  { id: 'a1000000-0000-4000-8000-000000000013', displayName: 'مریم رحیمی', type: 'BUSINESS', nationalId: null, mobile: null, mg: 128_900, status: 'ACTIVE' },
  { id: 'a1000000-0000-4000-8000-000000000014', displayName: 'سعید ابراهیمی', type: 'CONSUMER', nationalId: null, mobile: '09120556677', mg: 0, status: 'INACTIVE' },
] as const;

export const partyRecords: Party[] = parties.map((p) => ({
  id: p.id,
  type: p.type,
  displayName: p.displayName,
  mobile: p.mobile,
  nationalId: p.nationalId,
  linkedTenantId: null,
  status: p.status,
  notes: null,
  createdAt: NOW,
  updatedAt: NOW,
}));

/**
 * جست‌وجوی `mg` فیکسچر با شناسه — `partyBalancesFor`/`partyStatementEntriesFor`
 * (پایین همین فایل) به آن نیاز دارند اما `partyRecords`/`Party` واقعی این
 * فیلد را ندارند (مانده بخشی از شکل `partySchema` نیست). شخصی که فقط از
 * `POST /parties` (زمان اجرا) ساخته شده در این نگاشت نیست؛ `?? 0`
 * صدایش می‌زند — یعنی مانده‌ی صفر، دقیقاً رفتار درست برای شخص تازه.
 */
export const partyMgById: Record<string, number> = Object.fromEntries(
  parties.map((p) => [p.id, p.mg]),
);

/* ── کالا ─────────────────────────────────────────────────── */

// TODO(real-data): از ماژول inventory
export const items = [
  { id: 'I-001', code: 'BR-750-12', name: 'دستبند ۱۸ عیار', kind: 'article', karat: 750, grossMg: 12_350, stockCount: 3, stockMg: 37_050 },
  { id: 'I-002', code: 'NK-750-41', name: 'سرویس کامل ۱۸ عیار', kind: 'article', karat: 750, grossMg: 41_200, stockCount: 1, stockMg: 41_200 },
  { id: 'I-003', code: 'RG-750-04', name: 'انگشتر ۱۸ عیار', kind: 'article', karat: 750, grossMg: 4_180, stockCount: 8, stockMg: 33_440 },
  { id: 'I-004', code: 'AB-740', name: 'آبشده عیار ۷۴۰', kind: 'melted', karat: 740, grossMg: null, stockCount: null, stockMg: 1_240_000 },
  { id: 'I-005', code: 'AB-995', name: 'آبشده عیار ۹۹۵', kind: 'melted', karat: 995, grossMg: null, stockCount: null, stockMg: 320_000 },
  { id: 'I-006', code: 'CN-FULL', name: 'تمام بهار آزادی', kind: 'coin', karat: 900, grossMg: 8_133, stockCount: 12, stockMg: null },
  { id: 'I-007', code: 'CN-HALF', name: 'نیم سکه', kind: 'coin', karat: 900, grossMg: 4_066, stockCount: 7, stockMg: null },
] as const;

export const itemRecords = items.map((i) => ({
  id: i.id,
  code: i.code,
  name: i.name,
  kind: i.kind,
  karat: i.karat,
  grossMg: i.grossMg === null ? null : i.grossMg.toString(),
  stockCount: i.stockCount,
  stockMg: i.stockMg === null ? null : i.stockMg.toString(),
}));

/* ── کالای زیورآلات (FE-036) ──────────────────────────────── */

// TODO(real-data): از ماژول inventory (BE-025/BE-026)
/**
 * شکل دقیقاً `jewelryItemVersionSchema` واقعی است — کد و عنوان سه مورد
 * اول عمداً با `itemRecords` بالا (I-001..I-003) یکسان مانده تا داده‌ی
 * ساختگی کل برنامه یک مغازه‌ی واحد را توصیف کند. هر کالا اینجا فقط یک
 * نسخه‌ی باز دارد (`version: 1، validTo: null`) — تاریخچه‌ی نسخه‌های
 * قدیمی‌تر لازم نیست چون هیچ صفحه‌ای امروز آن را نمی‌خواهد.
 */
const jewelryItemsRaw = [
  { itemId: '1', code: 'BR-750-12', title: 'دستبند ۱۸ عیار', grossMg: 12_350, karat: 750, stoneMg: 0, otherMg: 0, wageType: 'PER_GRAM' as const, wageValue: 3_500_000, active: true },
  { itemId: '2', code: 'NK-750-41', title: 'سرویس کامل ۱۸ عیار', grossMg: 41_200, karat: 750, stoneMg: 850, otherMg: 0, wageType: 'PERCENT_X100' as const, wageValue: 1_200, active: true },
  { itemId: '3', code: 'RG-750-04', title: 'انگشتر ۱۸ عیار نگین‌دار', grossMg: 4_180, karat: 750, stoneMg: 320, otherMg: 0, wageType: 'PERCENT_X100' as const, wageValue: 1_500, active: true },
  { itemId: '4', code: 'ER-700-02', title: 'گوشواره عیار ۷۰۰', grossMg: 2_500, karat: 700, stoneMg: 0, otherMg: 0, wageType: 'FLAT' as const, wageValue: 8_000_000, active: true },
  { itemId: '5', code: 'CH-750-08', title: 'زنجیر گردن ۱۸ عیار', grossMg: 8_900, karat: 750, stoneMg: 0, otherMg: 0, wageType: 'PER_GRAM' as const, wageValue: 2_800_000, active: true },
  { itemId: '6', code: 'BR-585-06', title: 'النگو عیار ۱۴', grossMg: 6_100, karat: 585, stoneMg: 0, otherMg: 0, wageType: 'PERCENT_X100' as const, wageValue: 1_000, active: true },
  { itemId: '7', code: 'PN-750-03', title: 'آویز طرح قلب', grossMg: 3_200, karat: 750, stoneMg: 150, otherMg: 0, wageType: 'PERCENT_X100' as const, wageValue: 1_800, active: true },
  { itemId: '8', code: 'RG-700-05', title: 'انگشتر مردانه عیار ۷۰۰', grossMg: 5_600, karat: 700, stoneMg: 0, otherMg: 0, wageType: 'PER_GRAM' as const, wageValue: 2_200_000, active: false },
  { itemId: '9', code: 'ST-750-20', title: 'ست کامل عروس', grossMg: 65_000, karat: 750, stoneMg: 3_200, otherMg: 0, wageType: 'PERCENT_X100' as const, wageValue: 2_000, active: true },
  { itemId: '10', code: 'BC-750-15', title: 'دستبند مردانه کارتیه', grossMg: 15_800, karat: 750, stoneMg: 0, otherMg: 0, wageType: 'FLAT' as const, wageValue: 12_000_000, active: false },
] as const;

export const jewelryItemVersionRecords = jewelryItemsRaw.map((raw, index) => ({
  id: `g2000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  jewelryItemId: `g1000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  code: raw.code,
  title: raw.title,
  grossWeightMg: raw.grossMg.toString(),
  karat: raw.karat,
  stoneWeightMg: raw.stoneMg.toString(),
  otherDeductionWeightMg: raw.otherMg.toString(),
  wageType: raw.wageType,
  wageValue: raw.wageValue.toString(),
  validFrom: NOW,
  validTo: null,
  version: 1,
  active: raw.active,
}));

/* ── مانده‌ی کل ───────────────────────────────────────────── */

const creditMg = parties.filter((p) => p.mg > 0).reduce((sum, p) => sum + BigInt(p.mg), 0n);
const debitMg = parties.filter((p) => p.mg < 0).reduce((sum, p) => sum + BigInt(p.mg), 0n);

export const balanceSummary = {
  credit: dualToWire(creditMg),
  debit: dualToWire(debitMg),
  net: dualToWire(creditMg + debitMg),
  creditPartyCount: parties.filter((p) => p.mg > 0).length,
  debitPartyCount: parties.filter((p) => p.mg < 0).length,
};

/* ── سود ──────────────────────────────────────────────────── */

// TODO(real-data): از ماژول reporting
function profit(operationalMg: number, fluctuationMg: number, bubbleMg: number, percentX10: bigint) {
  const total = mg(operationalMg) + mg(fluctuationMg) + mg(bubbleMg);
  return {
    operational: dualToWire(mg(operationalMg)),
    fluctuation: dualToWire(mg(fluctuationMg)),
    coinBubble: dualToWire(mg(bubbleMg)),
    total: dualToWire(total),
    percentX10: percentX10.toString(),
  };
}

export const profitToday = { period: 'today' as const, ...profit(8_400, 3_100, 1_700, 14n) };
export const profitMonth = { period: 'month' as const, ...profit(162_000, 61_500, 26_500, 250n) };

/* ── معامله‌های اخیر ──────────────────────────────────────── */

// TODO(real-data): از ماژول sales و purchase
export const recentTransactions = [
  { id: 'TX-10432', partyName: 'حسین مرادی', kind: 'sale', title: 'دستبند ۱۸ عیار', mg: 12_350, at: '2026-07-30T11:42:00Z' },
  { id: 'TX-10431', partyName: 'زهرا کریمی', kind: 'second-hand', title: 'خرید دست‌دوم — عیار ۷۴۰', mg: -8_600, at: '2026-07-30T10:15:00Z' },
  { id: 'TX-10430', partyName: 'مهدی صادقی', kind: 'coin-sale', title: '۲ تمام بهار آزادی', mg: 14_640, at: '2026-07-30T09:58:00Z' },
  { id: 'TX-10429', partyName: 'فاطمه یوسفی', kind: 'sale', title: 'سرویس کامل ۱۸ عیار', mg: 41_200, at: '2026-07-29T18:20:00Z' },
  { id: 'TX-10428', partyName: 'علی‌رضا نجفی', kind: 'purchase', title: 'خرید آبشده', mg: -55_000, at: '2026-07-29T16:05:00Z' },
].map((t) => ({
  id: t.id,
  partyName: t.partyName,
  kind: t.kind,
  title: t.title,
  amount: dualToWire(mg(t.mg)),
  occurredAt: t.at,
}));

/** قیمت یک قلم مصنوع — برای پاسخ POST /api/invoices */
export function articlePriceRial(grossMg: bigint, k: number, wageRial: bigint): bigint {
  const rate = gramRate(MAZNEH_RIAL, karat(k));
  return mulDivHalfUp(grossMg, rate, 1000n) + wageRial;
}

/* ── مانده و صورت‌حساب یک شخص (FE-034) ───────────────────────── */

// TODO(real-data): از party-balances.service.ts (BE-056)
/**
 * دو بُعد **مستقل** ریال و طلای خالص — نه یک جفت تبدیل‌شده از هم، دقیقاً
 * مثل `rawBalances` واقعی. فقط شخص اول (حسین مرادی) مانده‌ی ریالی
 * غیرصفر دارد تا هر دو ردیف در UI واقعاً قابل‌آزمون باشند؛ بقیه فقط
 * همان `mg` که `balanceSummary` هم از آن می‌سازد.
 */
const PARTY_RIAL_BALANCE: Record<string, bigint> = {
  'a1000000-0000-4000-8000-000000000001': 45_000_000n,
};

/** کد ملی-مانند نیست، شناسه‌ی نوع سکه — باید UUID باشد (`coinTypeId: uuidSchema`). */
const COIN_TYPE = {
  BAHAR: { id: 'd1000000-0000-4000-8000-000000000001', code: 'تمام بهار آزادی' },
  NIM: { id: 'd1000000-0000-4000-8000-000000000002', code: 'نیم سکه' },
  ROB: { id: 'd1000000-0000-4000-8000-000000000003', code: 'ربع سکه' },
  GERAMI: { id: 'd1000000-0000-4000-8000-000000000004', code: 'سکه گرمی' },
} as const;

/**
 * فهرست نسخه‌ی جاری هر نوع سکه — `coinTypeVersionSchema` واقعی (BE-020).
 * ⚠️ FE-038: بدون endpoint واقعی هنوز، فقط `GET /api/inventory/coin-types`
 * mock (توضیح در `api/contracts.ts`). وزن‌ها از بخش ۳ `CLAUDE.md` (میکروگرم
 * — تنها استثنای مجاز `bigint` غیرمیلی‌گرمی، دقیقاً برای همین مشخصات مرجع).
 */
export const COIN_TYPE_VERSIONS = [
  { key: COIN_TYPE.BAHAR, versionId: 'e1000000-0000-4000-8000-000000000001', grossWeightUg: 8_133_000n, karat: 900 },
  { key: COIN_TYPE.NIM, versionId: 'e1000000-0000-4000-8000-000000000002', grossWeightUg: 4_066_500n, karat: 900 },
  { key: COIN_TYPE.ROB, versionId: 'e1000000-0000-4000-8000-000000000003', grossWeightUg: 2_033_200n, karat: 900 },
  { key: COIN_TYPE.GERAMI, versionId: 'e1000000-0000-4000-8000-000000000004', grossWeightUg: 1_016_600n, karat: 900 },
].map(({ key, versionId, grossWeightUg, karat: k }) => ({
  id: versionId,
  coinTypeId: key.id,
  code: key.code,
  title: key.code,
  grossWeightUg: grossWeightUg.toString(),
  karat: k,
  validFrom: NOW,
  validTo: null,
  version: 1,
  active: true,
  mintType: 'CENTRAL_BANK' as const,
  isCentralBankMinted: true as const,
}));

/**
 * مانده‌ی موجودی سکه — `inventoryBalanceSchema` واقعی (BE-028)، همان
 * `GET /inventory/balances?itemType=COIN`. عمداً «سکه گرمی» را نمی‌آورد:
 * نوعی که هرگز حرکتی نداشته اصلاً در پاسخ واقعی نیست، نه اینکه صفر باشد
 * — merge سمت `CoinInventoryPage` باید همین غیاب را صفر بخواند.
 */
export const COIN_BALANCE_ROWS = [
  { itemType: 'COIN' as const, itemId: COIN_TYPE.BAHAR.id, quantity: '3' },
  { itemType: 'COIN' as const, itemId: COIN_TYPE.NIM.id, quantity: '-1' },
  { itemType: 'COIN' as const, itemId: COIN_TYPE.ROB.id, quantity: '0' },
];

const PARTY_COIN_BALANCE: Record<string, ReadonlyArray<{ coinTypeId: string; code: string; count: number }>> = {
  'a1000000-0000-4000-8000-000000000001': [
    { coinTypeId: COIN_TYPE.BAHAR.id, code: COIN_TYPE.BAHAR.code, count: 2 },
    { coinTypeId: COIN_TYPE.NIM.id, code: COIN_TYPE.NIM.code, count: -1 },
  ],
  'a1000000-0000-4000-8000-000000000003': [
    { coinTypeId: COIN_TYPE.BAHAR.id, code: COIN_TYPE.BAHAR.code, count: 1 },
  ],
};

/**
 * `GET /parties/:id/balances` — قرارداد نهایی BE-056. `referenceQuoteId`
 * باید یک مظنه‌ی واقعی از `maznehQuoteHistory` باشد؛ اگر نبود همان خطای
 * سرور واقعی (`PartyBalanceReferenceQuoteNotFoundError`) شبیه‌سازی
 * می‌شود، نه یک عدد ساختگی صفر.
 */
export function partyBalancesFor(
  party: { id: string; mg: number },
  referenceQuote: { id: string; amountRial: string; observedAt: string } | undefined,
) {
  const rial = PARTY_RIAL_BALANCE[party.id] ?? 0n;
  const pureGoldMg = mg(party.mg);
  const coins = PARTY_COIN_BALANCE[party.id] ?? [];

  const convertedView =
    referenceQuote === undefined
      ? null
      : (() => {
          const rate1000 = gramRate1000(BigInt(referenceQuote.amountRial));
          const rialEquivalentPureGoldMg = dualFromRial(rial, rate1000).pureMg;
          return {
            displayUnit: 'GOLD' as const,
            referenceMazneh: {
              id: referenceQuote.id,
              amountRial: referenceQuote.amountRial,
              observedAt: referenceQuote.observedAt,
              goldRatePerGramRial: rate1000.toString(),
            },
            rialEquivalentPureGoldMg: rialEquivalentPureGoldMg.toString(),
            totalGoldDisplayPureMg: (pureGoldMg + rialEquivalentPureGoldMg).toString(),
            coinsRemainSeparate: true as const,
          };
        })();

  return {
    partyId: party.id,
    calculatedAt: new Date().toISOString(),
    defaultDisplayUnit: 'GOLD' as const,
    rawBalances: { rial: rial.toString(), pureGoldMg: pureGoldMg.toString(), coins },
    convertedView,
  };
}

// TODO(real-data): از party-statements.service.ts (BE-057)
/**
 * سه رویداد ساختگی در سه بُعد مختلف (ریال/طلا/سکه) برای هر شخص — کافی
 * برای اینکه «آخرین معاملات» خالی نباشد و هر سه شکل نمایش (ریالی، وزنی،
 * شمارشی) در همان صفحه واقعاً رندر شوند. `runningBalance` یک دنباله‌ی
 * ساده‌ی نزولی از مانده‌ی فعلی است، نه بازسازی دقیق تاریخچه‌ی دفتر —
 * برای یک mock کافی است.
 */
export function partyStatementEntriesFor(party: { id: string; mg: number }) {
  const sign = party.mg >= 0 ? 1n : -1n;
  const now = FETCHED_AT.getTime();
  const base = mg(Math.abs(party.mg));

  return [
    {
      ledgerTransactionId: `e1000000-0000-4000-8000-${party.id.slice(-12)}`,
      source: { type: 'SALES_INVOICE' as const, id: `f1000000-0000-4000-8000-${party.id.slice(-12)}` },
      effectiveAt: new Date(now - 1 * DAY_MS).toISOString(),
      description: `Cash jewelry sale INV-${party.id.slice(-4)}`,
      dimension: {
        id: 'd2000000-0000-4000-8000-000000000001',
        code: 'GOLD-1000',
        kind: 'GOLD' as const,
        coinTypeId: null,
        coinCode: null,
      },
      quantity: (sign * (base / 4n)).toString(),
      runningBalance: (sign * base).toString(),
      documentRateSnapshots: [],
    },
    {
      ledgerTransactionId: `e1000000-0000-4000-8000-${party.id.slice(-11)}0`,
      source: { type: 'SETTLEMENT' as const, id: `f1000000-0000-4000-8000-${party.id.slice(-11)}0` },
      effectiveAt: new Date(now - 5 * DAY_MS).toISOString(),
      description: `Rial settlement ${party.id.slice(-8)}`,
      dimension: {
        id: 'd2000000-0000-4000-8000-000000000002',
        code: 'RIAL',
        kind: 'RIAL' as const,
        coinTypeId: null,
        coinCode: null,
      },
      quantity: (-sign * 12_000_000n).toString(),
      runningBalance: (PARTY_RIAL_BALANCE[party.id] ?? 0n).toString(),
      documentRateSnapshots: [],
    },
    {
      ledgerTransactionId: `e1000000-0000-4000-8000-${party.id.slice(-10)}00`,
      source: { type: 'SECOND_HAND_PURCHASE' as const, id: `f1000000-0000-4000-8000-${party.id.slice(-10)}00` },
      effectiveAt: new Date(now - 12 * DAY_MS).toISOString(),
      description: `Second-hand gold purchase P-${party.id.slice(-4)}`,
      dimension: {
        id: 'd2000000-0000-4000-8000-000000000003',
        code: 'COIN-BAHAR',
        kind: 'COIN' as const,
        coinTypeId: COIN_TYPE.BAHAR.id,
        coinCode: COIN_TYPE.BAHAR.code,
      },
      quantity: sign.toString(),
      runningBalance: String(PARTY_COIN_BALANCE[party.id]?.[0]?.count ?? 0),
      documentRateSnapshots: [],
    },
  ];
}
