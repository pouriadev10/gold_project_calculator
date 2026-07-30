import type { DualAmount } from '@gold/core-calc';
import { dualFromPure, gramRate1000 } from '@gold/core-calc';
import { MOCK_MAZNEH_RIAL } from './market';

/**
 * داده‌ی ساختگی داشبورد.
 *
 * مبالغ از **وزن** ساخته می‌شوند، نه از ریال — چون واحد پایه‌ی این صنف
 * طلاست. نرخ در لحظه‌ی ساخت قفل می‌شود، دقیقاً مثل یک سند واقعی.
 */

// TODO(real-data): نرخ قفل‌شده‌ی هر سند از خود سند می‌آید، نه از مظنه‌ی امروز
const LOCKED_RATE = gramRate1000(MOCK_MAZNEH_RIAL);

/**
 * وزن‌ها مستقیم به **میلی‌گرم** نوشته می‌شوند.
 * هیچ ضرب شناوری در مسیر نیست — حتی در داده‌ی ساختگی.
 */
const mg = (milligrams: number): bigint => BigInt(milligrams);

export interface BalanceSummary {
  readonly credit: DualAmount;
  readonly debit: DualAmount;
  readonly net: DualAmount;
  readonly creditPartyCount: number;
  readonly debitPartyCount: number;
}

// TODO(real-data): از projection جدول account_balance بخوان
export const MOCK_BALANCE: BalanceSummary = {
  credit: dualFromPure(mg(1_240_500), LOCKED_RATE),
  debit: dualFromPure(-mg(860_250), LOCKED_RATE),
  net: dualFromPure(mg(380_250), LOCKED_RATE),
  creditPartyCount: 14,
  debitPartyCount: 9,
};

export interface ProfitBreakdown {
  /** سود عملیاتی — اجرت و حاشیه‌ی فروش */
  readonly operational: DualAmount;
  /** سود یا زیان ناشی از نوسان قیمت طلا روی موجودی */
  readonly fluctuation: DualAmount;
  /** سود ناشی از حباب سکه */
  readonly coinBubble: DualAmount;
  readonly total: DualAmount;
  /** درصد سود نسبت به سرمایه‌ی درگیر، در مقیاس ۱۰ — یک رقم اعشار، بدون شناور */
  readonly percentX10: bigint;
}

// TODO(real-data): از ماژول reporting با گزارش سود دو مقیاسه بخوان
export const MOCK_PROFIT_TODAY: ProfitBreakdown = {
  operational: dualFromPure(mg(8_400), LOCKED_RATE),
  fluctuation: dualFromPure(mg(3_100), LOCKED_RATE),
  coinBubble: dualFromPure(mg(1_700), LOCKED_RATE),
  total: dualFromPure(mg(13_200), LOCKED_RATE),
  percentX10: 14n,
};

// TODO(real-data): از ماژول reporting بخوان
export const MOCK_PROFIT_MONTH: ProfitBreakdown = {
  operational: dualFromPure(mg(162_000), LOCKED_RATE),
  fluctuation: dualFromPure(mg(61_500), LOCKED_RATE),
  coinBubble: dualFromPure(mg(26_500), LOCKED_RATE),
  total: dualFromPure(mg(250_000), LOCKED_RATE),
  percentX10: 250n,
};

export type TransactionKind = 'sale' | 'purchase' | 'second-hand' | 'coin-sale';

export interface RecentTransaction {
  readonly id: string;
  readonly partyName: string;
  readonly kind: TransactionKind;
  readonly title: string;
  readonly amount: DualAmount;
  readonly occurredAt: Date;
}

// TODO(real-data): از ماژول sales و purchase بخوان
export const MOCK_RECENT_TRANSACTIONS: readonly RecentTransaction[] = [
  {
    id: 'TX-10432',
    partyName: 'حسین مرادی',
    kind: 'sale',
    title: 'دستبند ۱۸ عیار',
    amount: dualFromPure(mg(12_350), LOCKED_RATE),
    occurredAt: new Date('2026-07-30T11:42:00'),
  },
  {
    id: 'TX-10431',
    partyName: 'زهرا کریمی',
    kind: 'second-hand',
    title: 'خرید دست‌دوم — عیار ۷۴۰',
    amount: dualFromPure(-mg(8_600), LOCKED_RATE),
    occurredAt: new Date('2026-07-30T10:15:00'),
  },
  {
    id: 'TX-10430',
    partyName: 'مهدی صادقی',
    kind: 'coin-sale',
    title: '۲ تمام بهار آزادی',
    amount: dualFromPure(mg(14_640), LOCKED_RATE),
    occurredAt: new Date('2026-07-30T09:58:00'),
  },
  {
    id: 'TX-10429',
    partyName: 'فاطمه یوسفی',
    kind: 'sale',
    title: 'سرویس کامل ۱۸ عیار',
    amount: dualFromPure(mg(41_200), LOCKED_RATE),
    occurredAt: new Date('2026-07-29T18:20:00'),
  },
  {
    id: 'TX-10428',
    partyName: 'علی‌رضا نجفی',
    kind: 'purchase',
    title: 'خرید آبشده',
    amount: dualFromPure(-mg(55_000), LOCKED_RATE),
    occurredAt: new Date('2026-07-29T16:05:00'),
  },
];
