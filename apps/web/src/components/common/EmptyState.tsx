import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * حالت «داده‌ای نیست» — هرگز صرفاً تزئینی نیست، همیشه یک اقدام مرتبط دارد.
 * برای «این بخش ساخته نشده» از همین با آیکون Construction استفاده کن
 * (نمونه: `PlaceholderPage`)، نه یک کامپوننت جدا.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <span
        className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <Icon className="size-7" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
