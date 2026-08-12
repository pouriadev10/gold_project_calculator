import type { ReactNode } from 'react';

/**
 * هدر فشرده‌ی چسبان بالای صفحه — الگوی مشترک همه‌ی صفحات به‌جز خانه.
 * خانه عنوان جدا ندارد؛ `MaznehBar` همان نقش را روی آن صفحه بازی می‌کند.
 */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
      <h1 className="text-base font-bold">{title}</h1>
      {children}
    </header>
  );
}
