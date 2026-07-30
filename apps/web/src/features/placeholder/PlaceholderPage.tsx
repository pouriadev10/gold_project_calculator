import { Construction } from 'lucide-react';
import { UnitToggle } from '@/components/common/UnitToggle';

/**
 * صفحه‌ی جانگه‌دار برای مسیرهایی که در فازهای بعد ساخته می‌شوند.
 *
 * کلید تعویض واحد از همین حالا اینجاست: هر صفحه‌ای که قرار است عدد مالی
 * نشان دهد، باید کلید داشته باشد. اگر بعداً اضافه شود، فراموش می‌شود.
 */
export function PlaceholderPage({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <h1 className="text-base font-bold">{title}</h1>
        <UnitToggle />
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
          <Construction className="size-7" aria-hidden="true" />
        </span>
        <p className="text-sm font-medium">این بخش هنوز ساخته نشده است</p>
        <p className="max-w-xs text-xs text-muted-foreground">{note}</p>
      </div>
    </div>
  );
}
