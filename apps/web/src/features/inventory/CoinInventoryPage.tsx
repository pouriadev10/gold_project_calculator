import { useMemo, useState } from 'react';
import { toSafeNumber } from '@gold/core-calc';
import { useCoinTypes, useInventoryBalances } from '@/api/queries';
import { PageHeader } from '@/components/common/PageHeader';
import { UnitToggle } from '@/components/common/UnitToggle';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { useMazneh } from '@/features/home/useMazneh';
import { CoinInventoryList, type CoinInventoryRow } from './CoinInventoryList';

/**
 * صفحه‌ی موجودی سکه — FE-038.
 *
 * دو fetch مستقل را ادغام می‌کند: کاتالوگ نوع سکه (`useCoinTypes`، فعلاً
 * فقط mock — بدون معادل بک‌اندی هنوز، همان الگوی `itemSchema`/
 * `profitReportSchema` در `api/contracts.ts`) و مانده‌ی واقعی هر نوع
 * (`GET /inventory/balances?itemType=COIN`، BE-028 واقعی). نوع سکه‌ای که
 * هیچ حرکتی نداشته اصلاً در پاسخ balances نیست — نه اینکه صفر باشد — پس
 * ادغام اینجا صریحاً برای هر کاتالوگ‌آیتم مانده‌ی نیامده را صفر می‌گیرد؛
 * دقیقاً همان چیزی که «صفر ... به‌صورت واضح نمایش داده شود» می‌خواهد.
 */

export default function CoinInventoryPage() {
  const coinTypesQuery = useCoinTypes();
  const balancesQuery = useInventoryBalances('COIN');
  const mazneh = useMazneh();
  const [marketPrices, setMarketPrices] = useState<Record<string, bigint>>({});

  const isLoading = coinTypesQuery.isLoading || balancesQuery.isLoading;
  const isError = coinTypesQuery.isError || balancesQuery.isError;

  const rows: readonly CoinInventoryRow[] | undefined = useMemo(() => {
    if (!coinTypesQuery.data) return undefined;
    const balanceByCoinTypeId = new Map(
      (balancesQuery.data ?? []).map((balance) => [balance.itemId, toSafeNumber(BigInt(balance.quantity))]),
    );
    return coinTypesQuery.data
      .filter((coinType) => coinType.active)
      .map((coinType) => ({
        coinType,
        count: balanceByCoinTypeId.get(coinType.coinTypeId) ?? 0,
      }));
  }, [coinTypesQuery.data, balancesQuery.data]);

  const retry = () => {
    void coinTypesQuery.refetch();
    void balancesQuery.refetch();
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="موجودی سکه">
        <UnitToggle />
      </PageHeader>

      <div className="flex-1 space-y-4 p-4 pb-nav">
        <CoinInventoryList
          rows={rows}
          isLoading={isLoading}
          isError={isError}
          onRetry={retry}
          rate1000={mazneh.data?.gram1000}
          marketPrices={marketPrices}
          onMarketPriceChange={(coinTypeId, value) =>
            setMarketPrices((prev) => ({ ...prev, [coinTypeId]: value }))
          }
        />
      </div>

      <NumericKeypad />
    </div>
  );
}
