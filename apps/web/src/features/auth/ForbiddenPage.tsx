import { Link } from '@tanstack/react-router';
import { ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';

/**
 * صفحه‌ی Forbidden — FE-028.
 *
 * فقط وقتی دیده می‌شود که کاربر **وارد شده** ولی نقشش برای این مسیر
 * مجاز نیست (`beforeLoad` نقش‌محور در `router.tsx`). داخل پوسته‌ی برنامه
 * می‌ماند — ناوبری همچنان دیده می‌شود تا کاربر بتواند به بخشی که واقعاً
 * دسترسی دارد برود، نه اینکه در یک صفحه‌ی تنها گیر بیفتد.
 */
export function ForbiddenPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title="دسترسی مجاز نیست" />
      <div className="flex flex-1 flex-col items-center justify-center">
        <EmptyState
          icon={ShieldAlert}
          title="اجازه‌ی دسترسی به این صفحه را ندارید"
          description="نقش شما در این حساب اجازه‌ی دیدن این بخش را نمی‌دهد. اگر فکر می‌کنید این اشتباه است، با مدیر فروشگاه صحبت کنید."
          action={
            <Button asChild size="action">
              <Link to="/dashboard">بازگشت به داشبورد</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
