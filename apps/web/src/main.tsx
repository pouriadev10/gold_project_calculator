import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { createQueryClient } from '@/api/query-client';
import { router } from '@/app/router';
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

  createRoot(container as HTMLElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

void bootstrap();
