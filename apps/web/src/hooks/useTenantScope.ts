import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { adoptTenantData, hasForeignTenantData, tenantDataOwner } from '@/lib/tenant-data';
import { useSessionStore } from '@/stores/session-store';
import { toast } from '@/stores/toast-store';

/**
 * تعویض مستأجر زیر پای پوسته — FE-102.
 *
 * بک‌اند کاربر را عضو چند مستأجر می‌پذیرد (`tenant_memberships`) ولی توکن به یک مستأجر بسته است
 * (`tid`) و endpoint ِ تعویضی ندارد؛ تعویض یعنی ورود دوباره با شناسه‌ی فروشگاه دیگر. نشست در
 * `localStorage` بین تب‌ها مشترک است، پس ورود فروشگاه «ب» در یک تب، نشست تبی را که داده‌ی «الف»
 * نشان می‌دهد هم بی‌خروج عوض می‌کند (`useSessionGuard` فقط گذار به null را می‌بیند).
 *
 * پوسته فقط برای مالکی (مستأجر:کاربر) که داده‌اش آماده است صفحه رندر می‌کند — `ready`. در همان
 * رندری که نشست عوض می‌شود، `ready` false است و پوسته به‌جای صفحه اسکلت نشان می‌دهد: هیچ فریمی
 * داده‌ی مستأجر قبلی را کنار نشست تازه نشان نمی‌دهد و هیچ صفحه‌ای با شناسه‌های قبلی و توکن تازه
 * درخواست نمی‌زند. سپس در effect: داده‌ی تب پاک (`adoptTenantData`)، مسیر امن (`/dashboard`، بدون
 * پرسش نگهبان ترک — پیش‌نویسی که می‌پرسید مال مستأجر قبلی و پاک‌شده است) و اعلان تعویض.
 *
 * mount ِ اول هم همین را می‌سنجد: تبی که پس از خروج در تب دیگر و ورود کاربر دیگر به برنامه برگردد
 * (یا تازه‌سازی شود) هنوز پیش‌نویس کاربر قبلی را در `sessionStorage` دارد.
 */
export function useTenantScope(): { readonly ready: boolean } {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const current = useSessionStore((state) => state.session);
  const owner = current ? tenantDataOwner(current) : null;
  const [readyOwner, setReadyOwner] = useState<string | null>(() =>
    current && !hasForeignTenantData(current) ? owner : null,
  );
  const ready = owner !== null && readyOwner === owner;

  useEffect(() => {
    if (ready || current === null || owner === null) return;
    const switched = readyOwner !== null;
    adoptTenantData(current, queryClient, switched);
    if (!switched) {
      setReadyOwner(owner);
      return;
    }

    let cancelled = false;
    toast.info('حساب فعال عوض شد', `${current.tenant.name} — ${current.user.displayName}`);
    void navigate({ to: '/dashboard', replace: true, ignoreBlocker: true }).finally(() => {
      if (!cancelled) setReadyOwner(owner);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, current, owner, readyOwner, queryClient, navigate]);

  return { ready };
}
