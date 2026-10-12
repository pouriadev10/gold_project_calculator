import { Suspense, lazy, useEffect, useState } from 'react';
import { useToastStore } from '@/stores/toast-store';

const Toaster = lazy(() => import('./Toaster').then((module) => ({ default: module.Toaster })));

/**
 * `Toaster` تنبل — FE-088.
 *
 * Radix Toast با وابستگی‌هایش (collection، dismissable-layer، presence، portal) حدود
 * ۶۵KB خام از بسته‌ی اولیه بود، در حالی که در اولین رنگ‌آمیزی هرگز toastی وجود ندارد.
 * حالا چانک جداست و دو راه برای بار شدن دارد، هرکدام زودتر رسید:
 *
 * - **اولین toast**: استور Zustand است و toastها پیش از سوار شدن رندرکننده هم در آن
 *   می‌مانند؛ به‌محض اولین `toast.*` چانک خواسته می‌شود و همان toast نمایش داده می‌شود.
 * - **`ready`** (در برنامه: `afterStartup` — داده‌ی صفحه‌ی اول کشیده شد): تا اولین toast
 *   واقعی (مثلاً پس از ثبت فاکتور) چانک از قبل حاضر باشد و پیام بی‌تأخیر بیاید — ولی
 *   هرگز هم‌زمان با محتوای LCP بار نشود.
 */
export function DeferredToaster({ ready }: { ready: Promise<void> }) {
  const hasToasts = useToastStore((state) => state.toasts.length > 0);
  const [prepared, setPrepared] = useState(false);

  useEffect(() => {
    let active = true;
    void ready.then(() => {
      if (active) setPrepared(true);
    });
    return () => {
      active = false;
    };
  }, [ready]);

  if (!hasToasts && !prepared) return null;
  return (
    <Suspense fallback={null}>
      <Toaster />
    </Suspense>
  );
}
