import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { Coins, Gem, Layers } from 'lucide-react';
import { dualFromPure, formatCoinCount, formatGram, toSafeNumber } from '@gold/core-calc';
import { useCoinTypes, useDashboard, useInventoryBalances, useJewelryItems, useRecentInventoryMovements } from '@/api/queries';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { PageHeader } from '@/components/common/PageHeader';
import { UnitToggle } from '@/components/common/UnitToggle';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { LowStockCard, LOW_STOCK_THRESHOLD, type LowStockItem } from './LowStockCard';
import { RecentMovementsCard } from './RecentMovementsCard';

/**
 * داشبورد موجودی — FE-040.
 *
 * پنج بخش «نمایش»ِ خودِ تسک، هر کدام از منبع واقعی خودش:
 * - **مصنوعات**: `useJewelryItems` (BE-026) + `useInventoryBalances('JEWELRY')`
 *   (BE-028) — دقیقاً همان ادغام «کاتالوگ + مانده، غیاب یعنی صفر» که
 *   `CoinInventoryPage` (FE-038) برای سکه انجام داد.
 * - **آبشده** و **انواع سکه**: از خودِ `GET /reporting/dashboard`
 *   (`dashboard.inventory`) — این endpoint هم آن‌ها را از دقیقاً همان
 *   `InventoryMovementsService.balances()` می‌سازد، پس یک fetch جدا برای
 *   مانده‌ی سکه اینجا لازم نیست (`useCoinTypes` فقط برای عنوان/`isActive`
 *   لازم است، نه شمارش).
 * - **اقلام کم‌موجود**: ترکیب زیورآلات+سکه (هر دو شمارشی)، آستانه‌ی
 *   نمایشی — توضیح در `LowStockCard.tsx`. آبشده وزن است، در این رتبه‌بندی
 *   نیست (قاعده‌ی ۲-۲ CLAUDE.md).
 * - **آخرین حرکات**: `useRecentInventoryMovements` — بدون معادل بک‌اندی
 *   هنوز (توضیح در `api/contracts.ts`).
 *
 * قواعد بخش FE-040: بدون چندشعبه‌ای، بدون امانی، بدون نقره/شمش در UI —
 * هیچ‌کدام اینجا مفهومی ندارند چون هیچ‌کدام از منابع داده‌ی بالا آن‌ها را
 * برنمی‌گردانند؛ رعایتشان یعنی چیزی برایشان *نساختن*، نه یک شرط صریح.
 */

export default function InventoryDashboardPage() {
  const dashboardQuery = useDashboard();
  const jewelryQuery = useJewelryItems({ active: true, limit: 200, offset: 0 });
  const jewelryBalanceQuery = useInventoryBalances('JEWELRY');
  const coinTypesQuery = useCoinTypes();
  const movementsQuery = useRecentInventoryMovements(5);

  const jewelryStock = useMemo(() => {
    if (!jewelryQuery.data || !jewelryBalanceQuery.data) return undefined;
    const countByItemId = new Map(
      jewelryBalanceQuery.data.map((b) => [b.itemId, toSafeNumber(BigInt(b.quantity))]),
    );
    return jewelryQuery.data.items.map((item) => ({
      id: item.jewelryItemId,
      label: item.title,
      count: countByItemId.get(item.jewelryItemId) ?? 0,
    }));
  }, [jewelryQuery.data, jewelryBalanceQuery.data]);

  const coinStock = useMemo(() => {
    if (!coinTypesQuery.data || !dashboardQuery.data) return undefined;
    const countByCoinTypeId = new Map(dashboardQuery.data.inventory.coins.map((c) => [c.coinTypeId, c.count]));
    return coinTypesQuery.data
      .filter((c) => c.active)
      .map((c) => ({ id: c.coinTypeId, label: c.title, count: countByCoinTypeId.get(c.coinTypeId) ?? 0 }));
  }, [coinTypesQuery.data, dashboardQuery.data]);

  const lowStockItems: readonly LowStockItem[] | undefined = useMemo(() => {
    if (!jewelryStock || !coinStock) return undefined;
    return [
      ...jewelryStock
        .filter((item) => item.count <= LOW_STOCK_THRESHOLD)
        .map((item): LowStockItem => ({ kind: 'JEWELRY', id: item.id, label: item.label, count: item.count })),
      ...coinStock
        .filter((item) => item.count <= LOW_STOCK_THRESHOLD)
        .map((item): LowStockItem => ({ kind: 'COIN', id: item.id, label: item.label, count: item.count })),
    ].sort((a, b) => a.count - b.count);
  }, [jewelryStock, coinStock]);

  const jewelryPieceTotal = jewelryStock?.reduce((sum, item) => sum + item.count, 0);
  const coinPieceTotal = coinStock?.reduce((sum, item) => sum + item.count, 0);
  const meltedGoldMg = dashboardQuery.data ? BigInt(dashboardQuery.data.inventory.meltedGoldPureMg) : undefined;
  const rate1000 = dashboardQuery.data?.currentMazneh
    ? BigInt(dashboardQuery.data.currentMazneh.goldRatePerGramRial)
    : undefined;

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="داشبورد موجودی">
        <UnitToggle />
      </PageHeader>

      <div className="flex-1 space-y-4 p-4 pb-nav lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0 xl:grid-cols-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-1 xl:col-span-3 xl:grid-cols-3">
          <Link to="/inventory/jewelry">
            <Card className="transition-colors hover:bg-accent/50">
              <CardContent className="flex items-center gap-3 pt-6">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
                  <Gem className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">مصنوعات</p>
                  {jewelryStock ? (
                    <p className="text-lg font-bold tabular-nums">
                      {formatCoinCount(jewelryStock.length)} نوع · {formatCoinCount(jewelryPieceTotal ?? 0)} عدد
                    </p>
                  ) : (
                    <Skeleton className="h-6 w-24" />
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>

          <Card>
            <CardContent className="flex items-center gap-3 pt-6">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
                <Layers className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">آبشده</p>
                {meltedGoldMg === undefined ? (
                  <Skeleton className="h-6 w-24" />
                ) : rate1000 === undefined ? (
                  <p className="text-lg font-bold tabular-nums">{formatGram(meltedGoldMg)} گرم</p>
                ) : (
                  <AmountDisplay amount={dualFromPure(meltedGoldMg, rate1000)} size="lg" />
                )}
              </div>
            </CardContent>
          </Card>

          <Link to="/inventory/coins">
            <Card className="transition-colors hover:bg-accent/50">
              <CardContent className="flex items-center gap-3 pt-6">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
                  <Coins className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">انواع سکه</p>
                  {coinStock ? (
                    <p className="text-lg font-bold tabular-nums">
                      {formatCoinCount(coinStock.length)} نوع · {formatCoinCount(coinPieceTotal ?? 0)} عدد
                    </p>
                  ) : (
                    <Skeleton className="h-6 w-24" />
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>

        <LowStockCard
          items={lowStockItems}
          isError={jewelryQuery.isError || jewelryBalanceQuery.isError || coinTypesQuery.isError || dashboardQuery.isError}
          onRetry={() => {
            void jewelryQuery.refetch();
            void jewelryBalanceQuery.refetch();
            void coinTypesQuery.refetch();
            void dashboardQuery.refetch();
          }}
        />

        <RecentMovementsCard
          items={movementsQuery.data}
          isError={movementsQuery.isError}
          onRetry={() => void movementsQuery.refetch()}
        />
      </div>
    </div>
  );
}
