import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/api-error';
import { RouteErrorFallback } from './RouteErrorFallback';

/**
 * FE-101 — خطای رندر یک مسیر: متن فارسی امن از `presentApiError`، نه `error.message` خام یا stack.
 * router ِ کوچک با همان `defaultErrorComponent` ِ برنامه؛ مسیر `/boom` در رندر پرتاب می‌کند.
 */
const SECRET = 'relation "ledger_entries" does not exist — amountRial=987654321 at /srv/app/dist/main.js:42';

let failures = 0;
let thrown: unknown = new Error(SECRET);

function renderFailingRoute() {
  const root = createRootRoute();
  const boom = createRoute({
    getParentRoute: () => root,
    path: '/boom',
    component: function Boom() {
      if (failures > 0) {
        failures -= 1;
        throw thrown;
      }
      return <p>صفحه سالم است</p>;
    },
  });
  const dashboard = createRoute({ getParentRoute: () => root, path: '/dashboard', component: () => <p>داشبورد</p> });
  const router = createRouter({
    routeTree: root.addChildren([boom, dashboard]),
    history: createMemoryHistory({ initialEntries: ['/boom'] }),
    defaultErrorComponent: RouteErrorFallback,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('RouteErrorFallback', () => {
  it('در production نه پیام خام نشان می‌دهد نه stack — فقط متن امن فارسی', async () => {
    vi.stubEnv('DEV', false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    failures = 99;
    thrown = new Error(SECRET);
    renderFailingRoute();

    expect(await screen.findByText('نمایش این صفحه ممکن نشد')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('ledger_entries');
    expect(document.body.textContent).not.toContain('987654321');
    expect(document.body.textContent).not.toContain('main.js');
    expect(screen.queryByText('جزئیات توسعه')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'بازگشت به داشبورد' })).toBeInTheDocument();
  });

  it('خطای API همان نگاشت امن ApiErrorNotice را می‌گیرد، با شناسه‌ی رهگیری', async () => {
    vi.stubEnv('DEV', false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    failures = 99;
    thrown = new ApiError(403, 'FORBIDDEN', SECRET, {}, 'req-123');
    renderFailingRoute();

    expect(await screen.findByText('اجازه انجام این عملیات را ندارید')).toBeInTheDocument();
    expect(screen.getByText('req-123')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('ledger_entries');
  });

  it('در توسعه پیام خام (بی stack) زیر «جزئیات توسعه» است', async () => {
    vi.stubEnv('DEV', true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    failures = 99;
    const error = new Error(SECRET);
    thrown = error;
    renderFailingRoute();

    expect(await screen.findByText('جزئیات توسعه')).toBeInTheDocument();
    expect(screen.getByText(SECRET)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(error.stack!.split('\n')[1]!.trim());
  });

  it('«تلاش دوباره» مسیر را دوباره رندر می‌کند', async () => {
    vi.stubEnv('DEV', false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    failures = 99; // ری‌اکت پس از خطای رندر خودش یک‌بار دوباره رندر می‌کند؛ تا «تلاش دوباره» خراب بماند
    thrown = new Error(SECRET);
    renderFailingRoute();

    await screen.findByText('نمایش این صفحه ممکن نشد');
    failures = 0;
    await userEvent.setup().click(screen.getByRole('button', { name: 'تلاش دوباره' }));
    expect(await screen.findByText('صفحه سالم است')).toBeInTheDocument();
  });
});
