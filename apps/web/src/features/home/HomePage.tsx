import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Minus, Plus } from 'lucide-react';
import { useBalanceSummary, useRecentTransactions } from '@/api/queries';
import { RequireRole } from '@/components/common/RequireRole';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { UnitToggle } from '@/components/common/UnitToggle';
import { Button } from '@/components/ui/button';
import { PROFIT_REPORT_ROLES } from '@/lib/permissions';
import { BalanceCard } from './BalanceCard';
import { MaznehBar } from './MaznehBar';
import { ProfitCard } from './ProfitCard';
import { RecentTransactions } from './RecentTransactions';

/**
 * صفحه‌ی اصلی — اولین چیزی که کاربر پس از ورود می‌بیند.
 *
 * ترتیب از بالا به پایین عمدی است و از BOOTSTRAP گام ۷ می‌آید:
 * مظنه → کلید واحد → مانده → سود → آخرین معامله‌ها → منطقه‌ی شست.
 *
 * دو دکمه‌ی فروش و خرید در **یک‌سوم پایین** نشسته‌اند و روی ۳۶۰px بدون
 * اسکرول دیده می‌شوند. اقدام اصلی هرگز بالای صفحه نمی‌رود — دست کاربر
 * روی گوشی به آنجا نمی‌رسد و او وسط معامله است.
 */
export function HomePage() {
  const isOnline = useOnlineStatus();
  const balance = useBalanceSummary();
  const transactions = useRecentTransactions(5);

  return (
    <div className="flex min-h-dvh flex-col">
      <MaznehBar isOnline={isOnline} />

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <span className="text-xs text-muted-foreground">واحد نمایش</span>
        <div className="flex flex-wrap items-center gap-2">
          <UnitToggle />
          {/* کلید پوسته اینجا هم هست تا کاربر برای شب‌کردن صفحه به تنظیمات نرود */}
          <ThemeToggle className="hidden sm:inline-flex" />
        </div>
      </div>

      <div className="flex-1 space-y-4 px-4 pb-action lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0 xl:grid-cols-3">
        <BalanceCard
          data={balance.data}
          isError={balance.isError}
          onRetry={() => void balance.refetch()}
        />
        {/* گزارش سود — FE-028: CASHIER نمی‌بیند، نه چون UI قشنگ‌تر می‌شود، چون دامنه‌ی دسترسی همین است */}
        <RequireRole roles={PROFIT_REPORT_ROLES}>
          <ProfitCard />
        </RequireRole>
        <div className="lg:col-span-2 xl:col-span-1">
          <RecentTransactions
            items={transactions.data?.items}
            isError={transactions.isError}
            onRetry={() => void transactions.refetch()}
          />
        </div>
      </div>

      {/*
        منطقه‌ی شست — ثابت، دقیقاً بالای نوار ناوبری (نه رویش).
        همیشه بدون اسکرول دیده می‌شود، چون کاربر وسط معامله است و
        نباید برای زدن «فروش» صفحه را بگردد.
      */}
      <div className="fixed inset-x-0 bottom-above-nav z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm lg:static lg:border-0 lg:bg-transparent lg:px-4 lg:pb-4">
        <div className="grid grid-cols-2 gap-3">
          <Button asChild size="action">
            <Link to="/sales/new">
              <Plus aria-hidden="true" />
              فروش
            </Link>
          </Button>
          <Button asChild size="action" variant="outline">
            <Link to="/purchase/second-hand">
              <Minus aria-hidden="true" />
              خرید
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/** وضعیت اتصال — برای نشانگر نوار مظنه. */
function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return isOnline;
}
