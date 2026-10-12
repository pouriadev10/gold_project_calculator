import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SaleKindTabs } from './SaleKindTabs';

/** FE-086 (آماده‌سازی) — فروش سکه از رابط کاربری قابل رسیدن است. */

function renderAt(path: string) {
  const rootRoute = createRootRoute({ component: SaleKindTabs });
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/sales/new' }),
    createRoute({ getParentRoute: () => rootRoute, path: '/sales/coins/new' }),
  ]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
}

describe('SaleKindTabs', () => {
  it('هر دو نوع فروش را با لینک واقعی نشان می‌دهد', async () => {
    renderAt('/sales/new');
    const nav = await screen.findByRole('navigation', { name: 'نوع فروش' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'زیورآلات' })).toHaveAttribute('href', '/sales/new');
    expect(screen.getByRole('link', { name: 'سکه' })).toHaveAttribute('href', '/sales/coins/new');
  });

  it('نوع جاری را با aria-current مشخص می‌کند — فقط یکی، نه هر دو', async () => {
    renderAt('/sales/coins/new');
    expect(await screen.findByRole('link', { name: 'سکه' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'زیورآلات' })).not.toHaveAttribute('aria-current');
  });
});
