import { formatCount } from '@gold/core-calc';
import { Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { AmountDisplay } from '@/components/common/AmountDisplay';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import type { PartyBalanceSummary } from '@/api/contracts';

/**
 * کارت مانده — بستانکار و بدهکار.
 *
 * اعداد از `AmountDisplay` عبور می‌کنند، پس با کلید تعویض واحد هم‌زمان
 * بین گرم و ریال جابه‌جا می‌شوند. «فلانی ۴۰ گرم بدهکار است» جمله‌ی
 * طبیعی این صنف است، نه ترجمه‌ی ریالی آن.
 */
export function BalanceCard({ data }: { data: PartyBalanceSummary | undefined }) {
  if (!data) return <BalanceCardSkeleton />;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground">مانده حساب‌ها</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">بستانکار</p>
            <p className="text-[0.6875rem] text-muted-foreground">
              {formatCount(data.creditPartyCount)} نفر
            </p>
          </div>
          <AmountDisplay amount={data.credit} signed size="lg" />
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">بدهکار</p>
            <p className="text-[0.6875rem] text-muted-foreground">
              {formatCount(data.debitPartyCount)} نفر
            </p>
          </div>
          <AmountDisplay amount={data.debit} signed size="lg" />
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">خالص</p>
          <AmountDisplay amount={data.net} signed size="lg" />
        </div>

        <Link
          to="/parties"
          className="inline-flex min-h-touch w-full cursor-pointer items-center justify-between rounded-lg px-1 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          مشاهده فهرست اشخاص
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}

export function BalanceCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <Skeleton className="h-4 w-28" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-2/3" />
      </CardContent>
    </Card>
  );
}
