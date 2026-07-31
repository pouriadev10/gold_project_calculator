import { karat } from '@gold/core-calc';
import { useCurrentRates } from '@/api/queries';

/**
 * مظنه‌ی جاری برای نوار بالای صفحه.
 *
 * داده از `GET /api/rates/current` می‌آید — همان endpointی که سرور واقعی
 * خواهد داشت. این هوک فقط شکل پاسخ را به چیزی که نوار مظنه لازم دارد
 * تبدیل می‌کند، نه اینکه داده بسازد.
 */

const DISPLAY_KARAT = karat(750);

export interface MaznehSnapshot {
  readonly mazneh: bigint;
  readonly gram750: bigint;
  readonly gram1000: bigint;
  readonly fullCoinPrice: bigint;
  readonly fetchedAt: Date;
}

export function useMazneh() {
  const query = useCurrentRates();

  const data: MaznehSnapshot | undefined = query.data
    ? {
        mazneh: query.data.maznehRial,
        gram750: query.data.gramRates.find((r) => r.karat === DISPLAY_KARAT)?.rateRial ?? 0n,
        gram1000: query.data.gramRates.find((r) => r.karat === 1000)?.rateRial ?? 0n,
        fullCoinPrice: query.data.coins[0]?.marketPriceRial ?? 0n,
        fetchedAt: new Date(query.data.fetchedAt),
      }
    : undefined;

  return { ...query, data };
}
