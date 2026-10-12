import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { createQueryClient } from '@/api/query-client';
import { loadInitialRoute, prefetchInitialRouteData } from '@/app/initial-route';
import { router } from '@/app/router';
import { DeferredToaster } from '@/components/common/DeferredToaster';
import { applyAppFontNow, applyAppFontOnNextPage, isAppFontLikelyCached } from '@/lib/app-font';
import { afterStartup, registerServiceWorker } from '@/lib/startup';
import { stylesheetsReady } from '@/lib/styles-ready';
import { useSessionStore } from '@/stores/session-store';
import '@/styles/globals.css';

const queryClient = createQueryClient();

const container = document.getElementById('root');
if (!container) throw new Error('عنصر ریشه پیدا نشد');

/**
 * در توسعه، پیش از رندر منتظر بالا آمدن سرویس‌ورکر ساختگی می‌مانیم.
 *
 * بدون این انتظار، اولین درخواست‌های TanStack Query ممکن است پیش از
 * فعال‌شدن worker رد شوند و صفحه با خطای شبکه بالا بیاید — رفتاری که
 * تصادفی و گیج‌کننده است.
 *
 * `import.meta.env.DEV` در بیلد production به `false` تبدیل می‌شود، پس
 * این شاخه و کل msw از باندل حذف می‌شوند.
 */
async function bootstrap(): Promise<void> {
  if (import.meta.env.DEV) {
    const { startMockWorker } = await import('@/mocks/browser');
    await startMockWorker();
  }

  // FE-088: فونتی که در کش است همین حالا خواسته می‌شود تا پیش از اولین رندر حاضر باشد.
  const fontCached = isAppFontLikelyCached();
  if (fontCached) void applyAppFontNow();

  // FE-088: داده‌ی اولین رنگ (مثلاً مظنه) هم‌زمان با چانک مسیر، نه پس از رندر آن.
  prefetchInitialRouteData(router, queryClient, useSessionStore.getState().session !== null);

  // FE-088: پوسته‌ی inline تا آمدن صفحه‌ی واقعی می‌ماند — نه اسکلت → سفید → اسپینر.
  // CSS غیرمسدودکننده است؛ React بدون آن هرگز نمی‌کشد. هر دو هم‌زمان منتظر می‌مانند.
  await Promise.all([loadInitialRoute(router), stylesheetsReady()]);

  // FE-088: آنچه صفحه‌ی اول لازم ندارد، پس از کشیده شدن داده‌ی صفحه‌ی اول — تا با محتوای
  // LCP بر سر پهنای باند و CPU رقابت نکند. (قولِ ساخته‌شده پیش از render؛ اولین بررسی‌اش
  // یک فریم بعد است، یعنی پس از commit همین رندر.)
  const startup = afterStartup(queryClient);

  createRoot(container as HTMLElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <DeferredToaster ready={startup} />
      </QueryClientProvider>
    </StrictMode>,
  );

  // فونت (بار اول؛ اعمال از ناوبری بعدی) و سرویس‌ورکر با precache حدود ۱٫۵MB.
  await startup;
  if (!fontCached) void applyAppFontOnNextPage((onNextPage) => router.subscribe('onResolved', onNextPage));
  if (import.meta.env.PROD) registerServiceWorker(import.meta.env.BASE_URL);
}

void bootstrap();
