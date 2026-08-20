import { Link } from '@tanstack/react-router';
import { Gem, Home, Settings, ShoppingCart, Users, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ناوبری اصلی.
 *
 * زیر ۱۰۲۴px نوار پایین (منطقه‌ی شست)، از ۱۰۲۴px به بالا سایدبار.
 * یک کامپوننت با دو چیدمان CSS — نه دو کامپوننت، تا حالت فعال و ترتیب
 * آیتم‌ها نتوانند از هم جدا بیفتند.
 *
 * مقصدها اقدام‌محورند، نه صرفاً بخش‌محور: «فروش» مستقیم به شروع فروش
 * می‌رود، نه یک صفحه‌ی میانی خالی — طبق قاعده‌ی هدف ثبت زیر ۱۵ ثانیه.
 */

const ITEMS = [
  { to: '/dashboard', label: 'خانه', icon: Home },
  { to: '/sales/new', label: 'فروش', icon: ShoppingCart },
  { to: '/purchase/second-hand', label: 'خرید', icon: Wallet },
  { to: '/inventory', label: 'موجودی', icon: Gem },
  { to: '/parties', label: 'اشخاص', icon: Users },
  { to: '/settings', label: 'تنظیمات', icon: Settings },
] as const;

export function AppNav() {
  return (
    <nav
      aria-label="ناوبری اصلی"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-safe',
        'lg:static lg:h-dvh lg:w-[var(--app-sidebar-w)] lg:shrink-0 lg:border-e lg:border-t-0 lg:pb-0',
      )}
    >
      <div className="hidden lg:block lg:px-4 lg:py-6">
        <span className="text-lg font-bold text-primary">حساب طلا</span>
      </div>

      <ul className="flex h-[var(--app-nav-h)] items-stretch justify-around lg:h-auto lg:flex-col lg:gap-1 lg:px-3">
        {ITEMS.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1 lg:flex-none">
            <Link
              to={to}
              className={cn(
                'flex min-h-touch cursor-pointer flex-col items-center justify-center gap-1 px-2 py-2 text-xs font-medium text-muted-foreground',
                'lg:flex-row lg:justify-start lg:gap-3 lg:rounded-lg lg:px-3 lg:text-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                'active:text-foreground lg:hover:bg-muted',
              )}
              activeProps={{
                className: 'text-primary lg:bg-muted',
                'aria-current': 'page',
              }}
            >
              <Icon className="size-6 lg:size-5" aria-hidden="true" />
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
