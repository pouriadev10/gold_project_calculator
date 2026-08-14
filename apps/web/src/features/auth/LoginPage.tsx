import { zodResolver } from '@hookform/resolvers/zod';
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
import { useSessionStore } from '@/stores/session-store';

/**
 * صفحه‌ی ورود — FE-026.
 *
 * ذخیره‌ی نشست و تصمیم «کجا و چطور» توکن نگه داشته شود عمداً حداقلی است
 * (`session-store.ts`، بدون persist) — همان‌طور که مسیر guard و منطق
 * تمدید هنوز نیستند، چون آن‌ها کار FE-027/FE-028 هستند. این صفحه فقط
 * باید endpoint واقعی را درست صدا بزند و پس از موفقیت مسیر را عوض کند.
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
      setSession(session);
      await navigate({ to: '/dashboard' });
    } catch (error) {
      setLoginError(loginErrorMessage(error));
    }
  });

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-4">
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
              {...register('email')}
            />
            {errors.email ? <InlineError message={errors.email.message ?? 'ایمیل معتبر نیست'} /> : null}
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
              <InlineError message={errors.password.message ?? 'رمز عبور الزامی است'} />
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
              {...register('tenantSlug')}
            />
            {errors.tenantSlug ? (
              <InlineError message={errors.tenantSlug.message ?? 'شناسه‌ی فروشگاه الزامی است'} />
            ) : null}
          </div>

          {loginError ? <InlineError message={loginError} /> : null}

          <Button type="submit" size="action" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            ورود
          </Button>
        </form>
      </div>
    </div>
  );
}
