import { useCallback, useRef } from 'react';
import { useBlocker, useRouter } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/common/ResponsiveDialog';

/**
 * هشدار خروج از فرم ثبت‌نشده — FE-099. هر صفحه‌ای که ورودی مالی یا تنظیماتی دارد این را با شرط
 * «چیزی برای از دست دادن هست» mount می‌کند.
 *
 * **چرا resolver، نه `useBlocker(() => true, cond)` ِ قدیمی.** آن امضا در TanStack Router یعنی
 * «بی‌صدا مسدود کن»: هیچ پرسشی نمی‌آید و ضربه روی ناوبری فقط هیچ کاری نمی‌کند — کاربر در فروش نیمه‌کاره
 * گیر می‌افتاد و نمی‌فهمید چرا. اینجا ناوبری داخلی (لینک، نوار پایین، دکمه‌ی back) یک گفت‌وگوی «ماندن /
 * ترک» باز می‌کند، و تازه‌سازی یا بستن تب هشدار خودِ مرورگر (`beforeunload`) را.
 *
 * - **هیچ ذخیره‌ی خودکاری نیست.** ترک صفحه هرگز چیزی به سرور نمی‌فرستد و هیچ سندی نمی‌سازد؛ نهایتاً
 *   پیش‌نویس همان تب (`draft="session"`، فقط sessionStorage ِ جادوگرهای فروش و خرید) می‌ماند.
 * - **حین ثبت** (`submitting`) ترک ممکن نیست: نتیجه‌ی یک نوشتن مالی در راه نباید دیده‌نشده بماند.
 * - **پس از ثبت موفق** صفحه `when` را false می‌کند و نگهبان کنار می‌رود — بدون هشدار.
 * - تغییر فقط search/hash همان صفحه (فیلترها) ناوبری خروج نیست و مسدود نمی‌شود.
 *
 * بیرون از `RouterProvider` (تست‌های تک‌کامپوننتی فرم‌ها) چیزی رندر نمی‌کند؛ در برنامه همیشه router هست.
 */
export function UnsavedChangesGuard(props: UnsavedChangesGuardProps) {
  const router = useRouter({ warn: false }) as ReturnType<typeof useRouter> | null;
  return router ? <RoutedGuard {...props} /> : null;
}

interface UnsavedChangesGuardProps {
  /** ورودی ثبت‌نشده‌ای هست. */
  readonly when: boolean;
  /** یک نوشتن مالی همین الان در راه است. */
  readonly submitting?: boolean;
  /** با ترک صفحه، ورودی دور ریخته می‌شود یا در پیش‌نویس همین تب می‌ماند. */
  readonly draft?: 'discard' | 'session';
}

function RoutedGuard({
  when,
  submitting = false,
  draft = 'discard',
}: UnsavedChangesGuardProps) {
  // ref تا نگهبان با هر رندر دوباره ثبت نشود؛ تصمیم همیشه با آخرین مقدار گرفته می‌شود.
  const state = useRef({ when, submitting });
  state.current = { when, submitting };

  const shouldBlockFn = useCallback(
    ({ current, next }: { current: { pathname: string }; next: { pathname: string } }) =>
      (state.current.when || state.current.submitting) && current.pathname !== next.pathname,
    [],
  );
  const enableBeforeUnload = useCallback(() => state.current.when || state.current.submitting, []);
  const blocker = useBlocker({ shouldBlockFn, enableBeforeUnload, withResolver: true });

  const open = blocker.status === 'blocked';
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) blocker.reset?.();
      }}
    >
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{submitting ? 'ثبت در حال انجام است' : 'تغییرات ثبت نشده‌اند'}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {submitting
              ? 'تا پاسخ سرور برسد در همین صفحه بمانید؛ نتیجه‌ی ثبت باید دیده شود.'
              : draft === 'session'
                ? 'هنوز هیچ سندی ثبت نشده است. اگر صفحه را ترک کنید، پیش‌نویس فقط در همین تب نگه داشته می‌شود و خودکار ثبت نمی‌شود.'
                : 'هنوز هیچ سندی ثبت نشده است. اگر صفحه را ترک کنید، اطلاعات واردشده از بین می‌رود.'}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter>
          <Button type="button" variant={submitting ? 'default' : 'outline'} onClick={() => blocker.reset?.()}>
            ماندن در صفحه
          </Button>
          {submitting ? null : (
            <Button type="button" variant="destructive" onClick={() => blocker.proceed?.()}>
              ترک صفحه
            </Button>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
