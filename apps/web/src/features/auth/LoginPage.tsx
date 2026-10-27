import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError } from '@/api/api-error';
import { login } from '@/api/auth';
import { loginSchema, type LoginInput } from '@/api/contracts';
import { presentApiError } from '@/api/error-presentation';
import { InlineError } from '@/components/common/InlineError';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import { claimTenantData } from '@/lib/tenant-data';
import { useSessionStore } from '@/stores/session-store';

/**
 * صفحه‌ی ورود — FE-026.
 *
 * نشست در `session-store.ts` (با persist، FE-027) و محافظ مسیرها در `route-guards.ts` (FE-028)
 * است. این صفحه endpoint واقعی را صدا می‌زند، داده‌ی مستأجر یا کاربر قبلی را پاک می‌کند
 * (`claimTenantData`، FE-101) و پس از موفقیت به داشبورد می‌رود.
 */

function loginErrorMessage(error: unknown): string {
  /*
   * ۴۰۱/۴۰۳ اینجا یعنی «ایمیل یا رمز غلط» / «مستأجر معلق است» —
   * پیام دقیقاً از auth.errors.ts می‌آید و امن است. `presentApiError`
   * عمومی ۴۰۱ را «نشست منقضی شده» ترجمه می‌کند که برای یک تلاش ورود
   * تازه معنا ندارد و گمراه‌کننده است.
   */
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return error.message;
  }
  return presentApiError(error).message;
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = useSearch({ from: '/login', strict: true });
  const setSession = useSessionStore((state) => state.setSession);
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', tenantSlug: '' },
  });

  const { submit, isSubmitting } = useIdempotentSubmit((key: string, values: LoginInput) =>
    login(values, key),
  );

  const onSubmit = handleSubmit(async (values) => {
    setLoginError(null);
    try {
      const session = await submit(values);
      if (!session) return; // ضربه‌ی دوم حین ارسال قبلی — بی‌اثر، نه خطا
      // FE-101: داده‌ی مستأجر یا کاربر دیگری که در این مرورگر مانده، پیش از نشست تازه پاک می‌شود
      claimTenantData(session, queryClient);
      setSession(session);
      await navigate({ to: '/dashboard' });
    } catch (error) {
      setLoginError(loginErrorMessage(error));
    }
  });

  return (
    // FE-084: ورود بیرون از پوسته‌ی برنامه است و `<main>` پوسته را ندارد؛ landmark خودش را می‌دهد.
    <main className="flex min-h-dvh flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-bold">ورود به حساب طلا</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            برای ادامه، مشخصات حساب کاربری‌تان را وارد کنید.
          </p>
        </div>

        {search.reason === 'expired' ? (
          <div
            role="alert"
            className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            نشست قبلی شما منقضی شده است. دوباره وارد شوید.
          </div>
        ) : null}

        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <div>
            <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium">
              ایمیل
            </label>
            <Input
              id="login-email"
              type="email"
              autoComplete="username"
              autoCorrect="off"
              autoCapitalize="off"
              inputMode="email"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'login-email-error' : undefined}
              {...register('email')}
            />
            {errors.email ? <InlineError id="login-email-error" message={errors.email.message ?? 'ایمیل معتبر نیست'} /> : null}
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium">
              رمز عبور
            </label>
            <div className="relative">
              <Input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'login-password-error' : undefined}
                className="pe-11"
                {...register('password')}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                disabled={isSubmitting}
                aria-label={showPassword ? 'پنهان‌کردن رمز عبور' : 'نمایش رمز عبور'}
                aria-pressed={showPassword}
                className="absolute inset-y-0 end-0 flex min-h-touch min-w-touch cursor-pointer items-center justify-center text-muted-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
            {errors.password ? (
              <InlineError id="login-password-error" message={errors.password.message ?? 'رمز عبور الزامی است'} />
            ) : null}
          </div>

          <div>
            <label htmlFor="login-tenant" className="mb-1.5 block text-sm font-medium">
              شناسه‌ی فروشگاه
            </label>
            <Input
              id="login-tenant"
              type="text"
              autoCorrect="off"
              autoCapitalize="off"
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.tenantSlug)}
              aria-describedby={errors.tenantSlug ? 'login-tenant-error' : undefined}
              {...register('tenantSlug')}
            />
            {errors.tenantSlug ? (
              <InlineError id="login-tenant-error" message={errors.tenantSlug.message ?? 'شناسه‌ی فروشگاه الزامی است'} />
            ) : null}
          </div>

          {loginError ? <InlineError message={loginError} /> : null}

          <Button type="submit" size="action" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            ورود
          </Button>
        </form>
      </div>
    </main>
  );
}
