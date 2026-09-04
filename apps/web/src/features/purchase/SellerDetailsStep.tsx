import { AlertTriangle, ShieldCheck, UserRound } from 'lucide-react';
import { PartySelector } from '@/components/common/PartySelector';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { maskMobileForDisplay } from '@/lib/sensitive-identity';
import type { PartySelection } from '@/stores/recent-parties-store';

export interface SellerDetailsStepProps {
  seller: PartySelection | null;
  onSellerChange: (seller: PartySelection | null) => void;
}

/** مرحله‌ی هویتی خرید دست‌دوم — FE-058. کد ملی خام فقط در API می‌ماند. */
export function SellerDetailsStep({ seller, onSellerChange }: SellerDetailsStepProps) {
  const isNonConsumer = seller !== null && seller.type !== 'CONSUMER';

  return (
    <section className="space-y-4" aria-labelledby="seller-details-title">
      <div className="flex items-start gap-2">
        <UserRound className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h2 id="seller-details-title" className="text-base font-semibold">
            مشخصات فروشنده
          </h2>
          <p className="text-xs leading-5 text-muted-foreground">
            شخص موجود را انتخاب کنید یا فروشنده‌ی مصرف‌کننده را همین‌جا بسازید.
          </p>
        </div>
      </div>

      <PartySelector
        label="فروشنده"
        value={seller}
        onChange={onSellerChange}
        inlineCreateVariant="SELLER"
      />

      {isNonConsumer ? (
        <p className="flex items-start gap-1.5 text-xs text-warning" role="alert">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          خرید دست‌دوم فقط از شخص مصرف‌کننده ثبت می‌شود؛ همکار انتخاب شده است.
        </p>
      ) : null}

      {seller ? (
        <Card className="p-4" aria-label="خلاصه امن مشخصات فروشنده">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">اطلاعات ثبت‌شده</h3>
            <Badge variant="outline">{seller.type === 'CONSUMER' ? 'مصرف‌کننده' : 'همکار'}</Badge>
          </div>

          <dl className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted-foreground">نام</dt>
            <dd className="min-w-0 break-words font-medium">{seller.displayName}</dd>

            <dt className="text-muted-foreground">موبایل</dt>
            <dd className="tabular-nums" dir="ltr">
              {seller.mobile ? maskMobileForDisplay(seller.mobile) : 'ثبت نشده'}
            </dd>

            <dt className="text-muted-foreground">کد ملی</dt>
            <dd className="tabular-nums" dir="ltr">
              {seller.nationalIdMasked ?? 'ثبت نشده (اختیاری)'}
            </dd>
          </dl>

          <p className="mt-4 flex items-start gap-1.5 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            برای حفظ حریم خصوصی، اطلاعات هویتی روی صفحه پوشانده می‌شوند و کد ملی کامل در پیش‌نویس ذخیره نمی‌شود.
          </p>
        </Card>
      ) : null}
    </section>
  );
}
