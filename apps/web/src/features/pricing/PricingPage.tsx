import { Lock } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { useHasRole } from '@/hooks/useHasRole';
import { MANUAL_QUOTE_ENTRY_ROLES } from '@/lib/permissions';
import { ManualQuoteForm } from './ManualQuoteForm';
import { QuoteHistoryList } from './QuoteHistoryList';

/**
 * صفحه‌ی مظنه — FE-030/FE-031. مقصد لینک «ثبت دستی» در `MaznehBar` (FE-029).
 *
 * نمایش «آخرین مظنه‌ی ثبت‌شده» بعد از ثبت مستقیماً از پاسخ سرور در
 * `ManualQuoteForm` می‌آید، نه از یک fetch جدا؛ فهرست تاریخچه‌ی زیرش
 * (`QuoteHistoryList`) با query جدای خودش کار می‌کند و بعد از ثبت موفق —
 * چون `queryKeys.pricing.all()` invalidate می‌شود — خودکار تازه می‌شود.
 * این صفحه عمداً به `features/home` (جایی که `useMazneh` زندگی می‌کند)
 * وابسته نیست؛ قاعده‌ی مرز Feature در `apps/web/src/STRUCTURE.md` هیچ
 * Featureای را مجاز نمی‌داند مستقیم internals یک Feature دیگر را import کند.
 *
 * بدون `UnitToggle`: مظنه ذاتاً ریالی است و طبق بخش ۵ design-system/MASTER.md
 * («نرخ‌ها ... عمداً از کلید تعویض واحد پیروی نمی‌کنند») هیچ معادل طلایی
 * معناداری برای تبدیل ندارد.
 *
 * دسترسی ثبت با `RolesGuard` سمت سرور یکسان است: `@Roles('OWNER', 'MANAGER')`
 * فقط روی `POST .../manual` نشسته (`price-quotes.controller.ts`)؛ خواندن
 * (`GET .../latest`, `GET .../quotes`) بدون `@Roles` است، یعنی برای هر
 * نقشی باز. پس کل مسیر برای هر نقشی باز می‌ماند (بدون `beforeLoad`
 * نقش‌محور در `router.tsx`)، تاریخچه همیشه دیده می‌شود، و فقط فرم ثبت
 * اینجا پنهان می‌شود — همان الگویی که `MaznehBar` برای لینک «ثبت دستی» دارد.
 */
export default function PricingPage() {
  const canEnter = useHasRole(MANUAL_QUOTE_ENTRY_ROLES);

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="مظنه" />

      <div className="flex-1 space-y-6 p-4 pb-96">
        <div className="space-y-4">
          {canEnter ? (
            <ManualQuoteForm />
          ) : (
            <EmptyState
              icon={Lock}
              title="دسترسی محدود"
              description="ثبت مظنه‌ی دستی فقط برای مدیر و صاحب فروشگاه در دسترس است."
            />
          )}
        </div>

        <div className="space-y-3">
          <h2 className="px-1 text-sm font-bold">تاریخچه‌ی مظنه</h2>
          <QuoteHistoryList />
        </div>
      </div>
    </div>
  );
}
