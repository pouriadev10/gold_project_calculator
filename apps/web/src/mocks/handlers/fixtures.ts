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
