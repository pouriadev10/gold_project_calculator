import { Link } from '@tanstack/react-router';
import { Construction } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { UnitToggle } from '@/components/common/UnitToggle';
import { Button } from '@/components/ui/button';

/**
 * صفحه‌ی جانگه‌دار برای مسیرهایی که در فازهای بعد ساخته می‌شوند.
 *
 * کلید تعویض واحد از همین حالا اینجاست: هر صفحه‌ای که قرار است عدد مالی
 * نشان دهد، باید کلید داشته باشد. اگر بعداً اضافه شود، فراموش می‌شود.
 */
export function PlaceholderPage({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <PageHeader title={title}>
        <UnitToggle />
      </PageHeader>

      <div className="flex flex-1 flex-col items-center justify-center">
        <EmptyState
          icon={Construction}
          title="این بخش هنوز ساخته نشده است"
          description={note}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/dashboard">بازگشت به داشبورد</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
