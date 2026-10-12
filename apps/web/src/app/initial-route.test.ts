import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ClientModule from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import { useSessionStore } from '@/stores/session-store';
import { loadInitialRoute, prefetchInitialRouteData } from './initial-route';
import { routeTree } from './router';

/** FE-088 — مسیر اولیه پیش از اولین رندر، و داده‌ی اولین رنگ هم‌زمان با چانکش. */

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof ClientModule>()),
  // هیچ درخواست واقعی؛ فقط اینکه چه کلیدی خواسته شد مهم است
  apiGet: vi.fn(() => new Promise(() => undefined)),
}));

afterEach(() => {
  useSessionStore.setState({ session: null });
});

function routerAt(path: string) {
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
}

function requestedKeys(client: QueryClient): string[] {
  return client
    .getQueryCache()
    .getAll()
    .map((query) => JSON.stringify(query.queryKey));
}

describe('prefetchInitialRouteData', () => {
  it('جادوگر فروش: مظنه پیش از رسیدن چانک صفحه خواسته می‌شود', () => {
    const client = new QueryClient();
    prefetchInitialRouteData(routerAt('/sales/new'), client, true);
    expect(requestedKeys(client)).toEqual([JSON.stringify(queryKeys.pricing.latestQuote('MAZNEH'))]);
  });

  it('خانه (و / که به آن هدایت می‌شود): مظنه + داشبورد با همان کلید DashboardOverview', () => {
    for (const path of ['/', '/dashboard']) {
      const client = new QueryClient();
      prefetchInitialRouteData(routerAt(path), client, true);
      expect(requestedKeys(client).sort()).toEqual(
        [
          JSON.stringify(queryKeys.pricing.latestQuote('MAZNEH')),
          JSON.stringify(queryKeys.dashboard.byUnit('GOLD')),
        ].sort(),
      );
    }
  });

  it('صفحه‌ای که مظنه نمی‌خواهد چیزی پیش‌دریافت نمی‌کند', () => {
    const client = new QueryClient();
    prefetchInitialRouteData(routerAt('/parties'), client, true);
    expect(requestedKeys(client)).toEqual([]);
  });

  it('بی‌نشست هیچ درخواستی نمی‌رود (محافظ به ورود می‌برد؛ درخواست ۴۰۱ می‌گرفت)', () => {
    const client = new QueryClient();
    prefetchInitialRouteData(routerAt('/sales/new'), client, false);
    expect(requestedKeys(client)).toEqual([]);
  });
});

describe('loadInitialRoute', () => {
  it('محافظ‌ها را اجرا و چانک تنبل مسیر نهایی را پیش از رندر بار می‌کند', async () => {
    const router = routerAt('/settings');
    await loadInitialRoute(router);

    // بی‌نشست: requireAuth به ورود هدایت کرد
    expect(router.state.location.pathname).toBe('/login');
    const login = router.routesById['/login'];
    expect(login?.options.component).toBeDefined();
    // چانک LoginPage پیش از رندر رسیده (چیزی برای بار کردن نمانده، نه حتی یک Promise)؛
    // رندر اول خودِ صفحه است، نه pending
    expect(router.loadRouteChunk(login!)).toBeUndefined();
  });

  it('هر خطایی را می‌بلعد تا رندر برنامه هرگز گیر نکند', async () => {
    const router = routerAt('/');
    vi.spyOn(router, 'load').mockRejectedValueOnce(new Error('chunk load failed'));
    await expect(loadInitialRoute(router)).resolves.toBeUndefined();
  });
});
