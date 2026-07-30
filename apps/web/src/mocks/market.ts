import type { CoinType } from '@gold/core-calc';
import { grossMg, karat } from '@gold/core-calc';

/**
 * داده‌ی ساختگی بازار.
 *
 * هر مقدار اینجا موقتی است. در فازهای بعد این ماژول با فید مظنه و جدول
 * `coin_type` دیتابیس جایگزین می‌شود — قاعده‌ی ۲-۶ CLAUDE.md می‌گوید هیچ
 * عدد صنفی در کد نمی‌ماند، این‌ها رکورد نسخه‌دار با بازه‌ی اعتبار می‌شوند.
 */

/** مظنه‌ی مثقال طلای آبشده‌ی ۱۷ عیار، به ریال. */
// TODO(real-data): از فید مظنه یا ورود دستی کاربر بخوان
export const MOCK_MAZNEH_RIAL = 480_000_000n;

/** زمان آخرین به‌روزرسانی مظنه — هرگز وانمود نکن قیمت لحظه‌ای است. */
// TODO(real-data): زمان واقعی دریافت از فید
export const MOCK_MAZNEH_FETCHED_AT = new Date('2026-07-30T09:12:00');

/**
 * مشخصات سکه‌های ضرب بانک مرکزی.
 * فقط این‌ها حباب دارند — هیچ شمشی، در هیچ حالتی.
 */
// TODO(real-data): از جدول coin_type با بازه‌ی اعتبار بخوان
export const MOCK_COIN_TYPES: readonly CoinType[] = [
  {
    kind: 'coin',
    id: 'bahar-azadi-new',
    label: 'تمام بهار آزادی',
    grossMg: grossMg(8133n),
    karat: karat(900),
  },
  {
    kind: 'coin',
    id: 'nim',
    label: 'نیم سکه',
    grossMg: grossMg(4066n),
    karat: karat(900),
  },
  {
    kind: 'coin',
    id: 'rob',
    label: 'ربع سکه',
    grossMg: grossMg(2033n),
    karat: karat(900),
  },
];

/** قیمت بازار هر سکه، به ریال. اختلافش با ارزش ذاتی همان حباب است. */
// TODO(real-data): از فید قیمت سکه بخوان
export const MOCK_COIN_MARKET_PRICE: Readonly<Record<string, bigint>> = {
  'bahar-azadi-new': 1_250_000_000n,
  nim: 640_000_000n,
  rob: 380_000_000n,
};
