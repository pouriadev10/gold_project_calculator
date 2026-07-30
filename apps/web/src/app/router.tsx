import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router';
import { AppNav } from '@/components/common/AppNav';
import { HomePage } from '@/features/home/HomePage';
import { PlaceholderPage } from '@/features/placeholder/PlaceholderPage';

function RootLayout() {
  return (
    <div className="lg:flex lg:items-stretch">
      <AppNav />
      {/* فاصله‌ی پایین به‌اندازه‌ی نوار ناوبری تا محتوا زیرش پنهان نشود */}
      <main className="min-w-0 flex-1 pb-nav">
        <Outlet />
      </main>
    </div>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
});

const salesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sales',
  component: () => (
    <PlaceholderPage title="فروش" note="ثبت فاکتور فروش زیورآلات و سکه در گام‌های بعد می‌آید." />
  ),
});

const purchaseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/purchase',
  component: () => (
    <PlaceholderPage title="خرید" note="خرید از مصرف‌کننده و خرید دست‌دوم در گام‌های بعد می‌آید." />
  ),
});

const partiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/parties',
  component: () => (
    <PlaceholderPage title="اشخاص" note="حساب اشخاص و مانده‌ها در گام‌های بعد می‌آید." />
  ),
});

const moreRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/more',
  component: () => (
    <PlaceholderPage title="بیشتر" note="تنظیمات، گزارش‌ها و پشتیبان‌گیری در گام‌های بعد می‌آید." />
  ),
});

/**
 * مسیر دود فقط در توسعه.
 *
 * `import.meta.env.DEV` در بیلد production به `false` تبدیل می‌شود، پس
 * کل این شاخه — و به‌همراهش `import()` تنبل صفحه‌ی دود — از درخت وابستگی
 * حذف می‌شود. نتیجه: این مسیر در بیلد نهایی اصلاً وجود ندارد.
 */
const devRoutes = import.meta.env.DEV
  ? [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/_dev/smoke',
        component: lazyRouteComponent(() => import('@/features/dev/SmokePage')),
      }),
    ]
  : [];

const routeTree = rootRoute.addChildren([
  indexRoute,
  salesRoute,
  purchaseRoute,
  partiesRoute,
  moreRoute,
  ...devRoutes,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
