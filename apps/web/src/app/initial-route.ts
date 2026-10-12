import type { QueryClient } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';
import { dashboardQueryOptions, latestPriceQuoteOptions } from '@/api/queries';

/**
 * داده‌ای که صفحه‌ی یک مسیر برای اولین رنگ لازم دارد و می‌شود پیش از رسیدن چانکش
 * خواست — FE-088. روی هر مسیر با `staticData.startupQueries` اعلام می‌شود.
 */
export type StartupQuery = 'mazneh' | 'dashboard';

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    startupQueries?: readonly StartupQuery[];
  }
}

/**
 * داده‌ی اولین رنگ مسیر اولیه را **هم‌زمان** با دانلود چانکش می‌خواهد — FE-088.
 *
 * بدون این، زنجیره‌ی باز کردن سرد `/sales/new` این بود: بسته‌ی اصلی → چانک‌های مسیر →
 * رندر → تازه درخواست مظنه → رندر دوباره. مظنه به چانک وابسته نیست، پس همین که بسته‌ی
 * اصلی اجرا شد خواسته می‌شود؛ صفحه که سوار شد آن را در کش TanStack Query می‌یابد
 * (همان کلید `useLatestPriceQuote`) و درخواست تکراری نمی‌رود.
 *
 * فقط با نشست: بی‌نشست، محافظ مسیر به ورود می‌برد و درخواست ۴۰۱ می‌گرفت.
 */
export function prefetchInitialRouteData(router: AnyRouter, client: QueryClient, isAuthenticated: boolean): void {
  if (!isAuthenticated) return;
  const wanted = new Set<StartupQuery>();
  for (const match of router.matchRoutes(router.state.location)) {
    const route = router.routesById[match.routeId];
    for (const query of route?.options.staticData?.startupQueries ?? []) wanted.add(query);
  }
  if (wanted.has('mazneh')) void client.prefetchQuery(latestPriceQuoteOptions('MAZNEH'));
  // همان درخواست ثابتِ GOLD که DashboardOverview می‌فرستد (چهره‌ی ریالی سمت کلاینت ساخته می‌شود)
  if (wanted.has('dashboard')) void client.prefetchQuery(dashboardQueryOptions('GOLD'));
}

/**
 * مسیر اولیه را پیش از اولین رندر React کامل بار می‌کند — FE-088.
 *
 * بدون این، React بلافاصله سوار می‌شود و پوسته‌ی inline `index.html` را پاک می‌کند،
 * در حالی که چانک تنبل مسیر هنوز در راه است: روتر تا `defaultPendingMs` (۱ ثانیه) هیچ
 * نمی‌کشد و بعد اسپینر — یعنی «اسکلت → سفید → اسپینر → صفحه». با صبر تا رسیدن چانک
 * (و اجرای `beforeLoad`ها، مثل هدایت به ورود)، اسکلت تا لحظه‌ی آمدن صفحه‌ی واقعی
 * سر جایش می‌ماند و اولین چیزی که React می‌کشد خودِ صفحه است.
 *
 * هر خطایی (مثلاً قطع شبکه هنگام گرفتن چانک) بلعیده می‌شود: روتر پس از سوار شدن
 * دوباره تلاش می‌کند و خطا را با مرز خطای خودش نشان می‌دهد.
 */
export async function loadInitialRoute(router: AnyRouter): Promise<void> {
  try {
    await router.load();
    await Promise.all(
      router.state.matches.map((match) => {
        const route = router.routesById[match.routeId];
        return route ? router.loadRouteChunk(route) : undefined;
      }),
    );
  } catch {
    // روتر پس از سوار شدن خودش دوباره بار می‌کند
  }
}
