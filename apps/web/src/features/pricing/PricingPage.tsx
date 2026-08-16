import { Lock } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { useHasRole } from '@/hooks/useHasRole';
import { MANUAL_QUOTE_ENTRY_ROLES } from '@/lib/permissions';
import { ManualQuoteForm } from './ManualQuoteForm';

/**
 * صفحه‌ی مظنه — FE-030. مقصد لینک «ثبت دستی» در `MaznehBar` (FE-029).
 *
 * فقط فرم ثبت دستی است؛ فهرست تاریخچه (FE-031) بعداً همین‌جا اضافه
 * می‌شود. نمایش «آخرین مظنه‌ی ثبت‌شده» مستقیماً از پاسخ سرور در
 * `ManualQuoteForm` می‌آید، نه از یک fetch جدا — این صفحه عمداً به
 * `features/home` (جایی که `useMazneh` زندگی می‌کند) وابسته نیست؛ قاعده‌ی
 * مرز Feature در `apps/web/src/STRUCTURE.md` هیچ Featureای را مجاز
 * نمی‌داند مستقیم internals یک Feature دیگر را import کند.
 *
 * بدون `UnitToggle`: مظنه ذاتاً ریالی است و طبق بخش ۵ design-system/MASTER.md
 * («نرخ‌ها ... عمداً از کلید تعویض واحد پیروی نمی‌کنند») هیچ معادل طلایی
 * معناداری برای تبدیل ندارد.
 *
 * دسترسی ثبت با `RolesGuard` سمت سرور یکسان است: `@Roles('OWNER', 'MANAGER')`
 * فقط روی `POST .../manual` نشسته (`price-quotes.controller.ts`)، نه روی
 * خواندن. پس کل مسیر برای هر نقشی باز می‌ماند (بدون `beforeLoad` نقش‌محور
 * در `router.tsx`) و فقط خودِ فرم اینجا پنهان می‌شود — همان الگویی که
 * `MaznehBar` برای لینک «ثبت دستی» دارد.
 */
export default function PricingPage() {
  const canEnter = useHasRole(MANUAL_QUOTE_ENTRY_ROLES);

  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="مظنه" />

      <div className="flex-1 space-y-4 p-4 pb-96">
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
    </div>
  );
}
