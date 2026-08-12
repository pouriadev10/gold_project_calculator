import { AlertTriangle } from 'lucide-react';
import { type ApiErrorPresentation, presentApiError } from '@/api/error-presentation';
import { InlineError } from '@/components/common/InlineError';
import { cn } from '@/lib/utils';

export interface ApiErrorNoticeProps {
  readonly error: unknown;
  readonly className?: string | undefined;
}

export interface ApiFieldErrorProps {
  readonly messages: readonly string[] | undefined;
  readonly className?: string | undefined;
}

/**
 * خطای ماندگار یک درخواست API.
 *
 * برای خطاهای مالی باید همراه state صفحه رندر شود، نه در toast کوتاه‌مدت. شناسه‌ی
 * رهگیری فقط داخل بخش جزئیات قرار می‌گیرد تا هم برای پشتیبانی در دسترس باشد و هم
 * تراکم صفحه را بالا نبرد.
 */
export function ApiErrorNotice({ error, className }: ApiErrorNoticeProps) {
  const presentation = presentApiError(error);

  return <ApiErrorNoticeContent presentation={presentation} className={className} />;
}

export function ApiErrorNoticeContent({
  presentation,
  className,
}: {
  readonly presentation: ApiErrorPresentation;
  readonly className?: string | undefined;
}) {
  return (
    <section
      className={cn(
        'rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-foreground',
        className,
      )}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <h2 className="text-sm font-bold">{presentation.title}</h2>
          <p className="text-sm leading-6">{presentation.message}</p>
          {presentation.requestId ? (
            <details className="pt-1 text-xs text-muted-foreground">
              <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                جزئیات برای پشتیبانی
              </summary>
              <code className="mt-2 block break-all" dir="ltr">
                {presentation.requestId}
              </code>
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** خطای یک فیلد فرم؛ بلافاصله زیر همان ورودی نمایش داده می‌شود. */
export function ApiFieldError({ messages, className }: ApiFieldErrorProps) {
  if (!messages?.length) return null;

  return <InlineError message={messages[0]!} className={className} />;
}
