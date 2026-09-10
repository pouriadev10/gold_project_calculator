import { Link } from '@tanstack/react-router';
import { Coins, Scale } from 'lucide-react';
import { cn } from '@/lib/utils';

const TAB_CLASS = cn('flex min-h-touch cursor-pointer items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
  'text-muted-foreground active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2');

export function PurchaseKindTabs() {
  return <nav aria-label="نوع خرید" className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
    <Link to="/purchase/second-hand" className={TAB_CLASS} activeOptions={{ exact: true }} activeProps={{ className: 'bg-card text-foreground shadow-sm', 'aria-current': 'page' }}>
      <Scale className="size-4" aria-hidden="true" />طلای دست‌دوم
    </Link>
    <Link to="/purchase/second-hand/coins" className={TAB_CLASS} activeProps={{ className: 'bg-card text-foreground shadow-sm', 'aria-current': 'page' }}>
      <Coins className="size-4" aria-hidden="true" />سکه
    </Link>
  </nav>;
}
