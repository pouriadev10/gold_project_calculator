import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useQueryErrorResetBoundary } from '@tanstack/react-query';
import { presentApiError } from '@/api/error-presentation';
import { ApiErrorNoticeContent } from '@/components/common/ApiErrorNotice';
import { Button } from '@/components/ui/button';

/**
 * خطای رندر یا بارگذاری یک مسیر — FE-101 («stack trace»).
 *
 * بدون این، TanStack Router کامپوننت پیش‌فرض خودش را نشان می‌داد: متن انگلیسی و دکمه‌ای که
 * `error.message` خام را باز می‌کند — پیامی که می‌تواند مسیر فایل، جزئیات zod، نام جدول یا
 * مقدار مالی داشته باشد. اینجا متن فقط از `presentApiError` می‌آید (نگاشت امن کد/وضعیت HTTP،
 * همان مسیر `ApiErrorNotice`) و شناسه‌ی رهگیری برای پشتیبانی؛ پیام خام و stack هرگز رندر نمی‌شود.
 * فقط در توسعه (`import.meta.env.DEV`) پیام خام، بدون stack، زیر «جزئیات توسعه» دیده می‌شود.
 */
export function RouteErrorFallback({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const queryErrorReset = useQueryErrorResetBoundary();
  const presentation = presentApiError(error);
  const devMessage = import.meta.env.DEV && error instanceof Error ? error.message : null;

  function retry() {
    queryErrorReset.reset();
    reset();
    void router.invalidate();
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-8">
      <ApiErrorNoticeContent
        presentation={
          presentation.kind === 'unknown'
            ? { ...presentation, title: 'نمایش این صفحه ممکن نشد' }
            : presentation
        }
      />
      {devMessage !== null ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">جزئیات توسعه</summary>
          <code className="mt-2 block whitespace-pre-wrap break-all" dir="ltr">
            {devMessage}
          </code>
        </details>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" size="action" onClick={retry}>
          تلاش دوباره
        </Button>
        <Button asChild size="action" variant="outline">
          <Link to="/dashboard">بازگشت به داشبورد</Link>
        </Button>
      </div>
    </div>
  );
}
