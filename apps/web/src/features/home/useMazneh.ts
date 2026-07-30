import { useQuery } from '@tanstack/react-query';
import { gramRate, gramRate1000, karat } from '@gold/core-calc';
import {
  MOCK_COIN_MARKET_PRICE,
  MOCK_COIN_TYPES,
  MOCK_MAZNEH_FETCHED_AT,
  MOCK_MAZNEH_RIAL,
} from '@/mocks/market';

export interface MaznehSnapshot {
  /** مظنه‌ی مثقال طلای آبشده، به ریال */
  readonly mazneh: bigint;
  /** نرخ هر گرم عیار ۷۵۰ */
  readonly gram750: bigint;
  /** نرخ هر گرم طلای خالص ۱۰۰۰ — مبنای ارزش ذاتی سکه */
  readonly gram1000: bigint;
  /** قیمت بازار سکه‌ی تمام */
  readonly fullCoinPrice: bigint;
  /** زمان دریافت — همیشه نشان داده می‌شود */
  readonly fetchedAt: Date;
}

const K750 = karat(750);

/**
 * مظنه‌ی جاری.
 *
 * فعلاً داده‌ی ساختگی برمی‌گرداند ولی از همان مسیر TanStack Query عبور
 * می‌کند تا وقتی فید واقعی وصل شد، فقط بدنه‌ی `queryFn` عوض شود.
 *
 * `fetchedAt` بخشی از قرارداد است، نه یک اضافه‌ی تزئینی: کاربر باید
 * بداند این عدد مال چه لحظه‌ای است. **هرگز وانمود نکن قیمت به‌روز است.**
 */
export function useMazneh() {
  return useQuery<MaznehSnapshot>({
    queryKey: ['mazneh'],
    // TODO(real-data): جایگزینی با فید مظنه یا ورود دستی کاربر
    queryFn: async () => ({
      mazneh: MOCK_MAZNEH_RIAL,
      gram750: gramRate(MOCK_MAZNEH_RIAL, K750),
      gram1000: gramRate1000(MOCK_MAZNEH_RIAL),
      fullCoinPrice: MOCK_COIN_MARKET_PRICE[MOCK_COIN_TYPES[0]?.id ?? ''] ?? 0n,
      fetchedAt: MOCK_MAZNEH_FETCHED_AT,
    }),
    staleTime: 60_000,
  });
}
