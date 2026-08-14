import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast';
import { useToastStore, type ToastVariant } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

/**
 * رندرکننده‌ی سراسری toastها — یک‌بار در ریشه‌ی برنامه سوار می‌شود
 * (`main.tsx`). خودِ toastها از هر جای کد، حتی خارج از کامپوننت، با
 * `toast.success(...)` و مشابه (در `@/stores/toast-store`) اضافه می‌شوند؛
 * این کامپوننت فقط استور را می‌خواند و رندر می‌کند.
 *
 * هیچ اطلاعاتی فقط با رنگ منتقل نمی‌شود — هر شدت آیکون مستقل خودش را
 * دارد، نه فقط رنگ حاشیه.
 */

const VARIANT_ICON: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const VARIANT_ICON_CLASS: Record<ToastVariant, string> = {
  success: 'text-success',
  error: 'text-destructive',
  warning: 'text-warning',
  info: 'text-muted-foreground',
};

/**
 * موفقیت و اطلاع‌رسانی مزاحم نمی‌شوند (`background` ≈ `aria-live="polite"`)؛
 * خطا و conflict باید فوری اعلام شوند (`foreground` ≈ `aria-live="assertive"`) —
 * همان تفکیک شدتی که `ApiErrorNotice` (FE-009) با `aria-live="assertive"` دارد.
 */
const VARIANT_ARIA_TYPE: Record<ToastVariant, 'foreground' | 'background'> = {
  success: 'background',
  info: 'background',
  warning: 'foreground',
  error: 'foreground',
};

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <ToastProvider duration={5000}>
      {toasts.map(({ id, variant, title, description, duration, open }) => {
        const Icon = VARIANT_ICON[variant];
        return (
          <Toast
            key={id}
            variant={variant}
            type={VARIANT_ARIA_TYPE[variant]}
            duration={duration}
            open={open}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) dismiss(id);
            }}
          >
            <Icon className={cn('mt-0.5 size-5 shrink-0', VARIANT_ICON_CLASS[variant])} aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1">
              <ToastTitle>{title}</ToastTitle>
              {description ? <ToastDescription>{description}</ToastDescription> : null}
            </div>
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
