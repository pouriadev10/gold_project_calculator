import { Link } from '@tanstack/react-router';
import { Coins, Gem } from 'lucide-react';
import { cn } from '@/lib/utils';

const TAB_CLASS = cn(
  'flex min-h-touch cursor-pointer items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
  'text-muted-foreground active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
);

/**
 * انتخاب نوع فروش — زیورآلات (جادوگر FE-041…) یا سکه (FE-048).
 *
 * قرینه‌ی `PurchaseKindTabs`. تا پیش از این، صفحه‌ی فروش سکه هیچ ورودی‌ای از
 * رابط کاربری نداشت و فقط با تایپ نشانی `/sales/coins/new` باز می‌شد (یافته‌ی
 * آماده‌سازی FE-086).
 */
export function SaleKindTabs() {
  return (
    <nav aria-label="نوع فروش" className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
      <Link
        to="/sales/new"
        className={TAB_CLASS}
        activeOptions={{ exact: true }}
        activeProps={{ className: 'bg-card text-foreground shadow-sm', 'aria-current': 'page' }}
      >
        <Gem className="size-4" aria-hidden="true" />
        زیورآلات
      </Link>
      <Link
        to="/sales/coins/new"
        className={TAB_CLASS}
        activeProps={{ className: 'bg-card text-foreground shadow-sm', 'aria-current': 'page' }}
      >
        <Coins className="size-4" aria-hidden="true" />
        سکه
      </Link>
    </nav>
  );
}
