import { RefreshCw, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { applyUpdate } from '@/lib/pwa-update';
import { useAppUpdateStore } from '@/stores/app-update-store';

/**
 * نوارهای وضعیت سراسری برنامه — FE-090. بالای همه‌ی صفحه‌ها (حتی ورود)، در جریان صفحه؛
 * پایین صفحه منطقه‌ی شست و اقدام اصلی است و نباید پوشیده شود.
 */
export function AppStatusBanners() {
  return (
    <>
      <OfflineBanner />
      <AppUpdateBanner />
    </>
  );
}

/**
 * «قطع اینترنت پیام واضح بدهد». ناحیه‌ی `role="status"` همیشه mount است تا صفحه‌خوان
 * ظاهر شدن پیام را اعلام کند (ناحیه‌ی زنده‌ای که همراه متنش ساخته شود، اعلام نمی‌شود).
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  return (
    <div role="status" aria-live="polite">
      {online ? null : (
        <div className="flex items-start gap-2 border-b border-border bg-warning px-4 py-2 text-sm leading-6 text-warning-foreground">
          <WifiOff className="mt-1 size-4 shrink-0" aria-hidden="true" />
          <p>
            <strong className="font-semibold">اتصال اینترنت قطع است.</strong> ثبت معامله و هر عملیات
            مالی تا وصل شدن غیرفعال است؛ هیچ چیزی آفلاین ذخیره یا بعداً خودکار ارسال نمی‌شود. اعداد
            صفحه ممکن است به‌روز نباشند.
          </p>
        </div>
      )}
    </div>
  );
}

/** نسخه‌ی تازه نصب شده و منتظر است؛ فقط با تصمیم کاربر فعال می‌شود (صفحه یک بار بارگذاری می‌شود). */
export function AppUpdateBanner() {
  const waiting = useAppUpdateStore((state) => state.waiting);
  const dismissed = useAppUpdateStore((state) => state.dismissed);
  const dismiss = useAppUpdateStore((state) => state.dismiss);
  if (waiting === null || dismissed) return null;

  return (
    <section
      aria-labelledby="app-update-title"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card px-4 py-2"
    >
      <RefreshCw className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm leading-6">
        <h2 id="app-update-title" className="font-semibold">
          نسخه‌ی تازه‌ی برنامه آماده است
        </h2>
        <p className="text-muted-foreground">
          اگر ثبتی نیمه‌کاره دارید، پیش از به‌روزرسانی آن را تمام کنید.
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="min-h-touch" onClick={dismiss}>
          بعداً
        </Button>
        <Button type="button" className="min-h-touch" onClick={() => applyUpdate(waiting)}>
          به‌روزرسانی
        </Button>
      </div>
    </section>
  );
}
