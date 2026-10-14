import {
  Link,
  Outlet,
  RouterProvider,
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { UnsavedChangesGuard } from './UnsavedChangesGuard';

/**
 * FE-099 — نگهبان خروج روی router ِ واقعی TanStack (نه mock): ناوبری داخلی به گفت‌وگوی «ماندن / ترک»
 * می‌رسد، حین ثبت ترک ممکن نیست، و `beforeunload` فقط وقتی چیزی برای از دست دادن هست فعال است.
 */

const page = { when: false, submitting: false, draft: 'discard' as 'discard' | 'session' };

/** فرم آزمایشی: وضعیت اولیه از `page`، و «تایپ» مثل ورود واقعی کاربر آن را کثیف می‌کند. */
function FormPage() {
  const [dirty, setDirty] = useState(page.when);
  return (
    <main>
      <h1>فرم</h1>
      <button type="button" onClick={() => setDirty(true)}>
        تایپ
      </button>
      {/* مسیرهای همین تست، نه routeTree ِ برنامه که Link برایش تایپ شده */}
      <Link to={'/other' as never}>برو به صفحه‌ی دیگر</Link>
      <Link to={'/form' as never} search={{ tab: 'x' } as never}>
        همین صفحه با فیلتر
      </Link>
      <UnsavedChangesGuard when={dirty} submitting={page.submitting} draft={page.draft} />
    </main>
  );
}

function buildRouter(history = createMemoryHistory({ initialEntries: ['/form'] })) {
  const root = createRootRoute({ component: () => <Outlet /> });
  const form = createRoute({ getParentRoute: () => root, path: '/form', component: FormPage });
  const other = createRoute({ getParentRoute: () => root, path: '/other', component: () => <h1>صفحه‌ی دیگر</h1> });
  return createRouter({ routeTree: root.addChildren([form, other]), history });
}

async function renderAt() {
  const router = buildRouter();
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: 'فرم' });
  return router;
}

afterEach(() => {
  page.when = false;
  page.submitting = false;
  page.draft = 'discard';
});

describe('UnsavedChangesGuard — FE-099', () => {
  it('فرم بدون تغییر: ناوبری بی‌پرسش انجام می‌شود', async () => {
    const user = userEvent.setup();
    const router = await renderAt();

    await user.click(screen.getByRole('link', { name: 'برو به صفحه‌ی دیگر' }));

    expect(await screen.findByRole('heading', { name: 'صفحه‌ی دیگر' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/other');
    expect(screen.queryByText('تغییرات ثبت نشده‌اند')).not.toBeInTheDocument();
  });

  it('فرم ثبت‌نشده: ناوبری پرسیده می‌شود — «ماندن» صفحه را نگه می‌دارد، «ترک» می‌رود', async () => {
    page.when = true;
    const user = userEvent.setup();
    const router = await renderAt();

    await user.click(screen.getByRole('link', { name: 'برو به صفحه‌ی دیگر' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('تغییرات ثبت نشده‌اند');
    expect(screen.getByRole('dialog')).toHaveTextContent('اطلاعات واردشده از بین می‌رود');
    expect(router.state.location.pathname).toBe('/form');

    await user.click(screen.getByRole('button', { name: 'ماندن در صفحه' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/form');
    expect(screen.getByRole('heading', { name: 'فرم' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'برو به صفحه‌ی دیگر' }));
    await user.click(await screen.findByRole('button', { name: 'ترک صفحه' }));
    expect(await screen.findByRole('heading', { name: 'صفحه‌ی دیگر' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/other');
  });

  it('پیش‌نویس نشست: پیام می‌گوید پیش‌نویس می‌ماند و خودکار ثبت نمی‌شود', async () => {
    page.when = true;
    page.draft = 'session';
    const user = userEvent.setup();
    await renderAt();

    await user.click(screen.getByRole('link', { name: 'برو به صفحه‌ی دیگر' }));

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'پیش‌نویس فقط در همین تب نگه داشته می‌شود و خودکار ثبت نمی‌شود',
    );
  });

  it('حین ثبت مالی ترک ممکن نیست — فقط «ماندن»', async () => {
    page.submitting = true;
    const user = userEvent.setup();
    const router = await renderAt();

    await user.click(screen.getByRole('link', { name: 'برو به صفحه‌ی دیگر' }));

    expect(await screen.findByRole('dialog')).toHaveTextContent('ثبت در حال انجام است');
    expect(screen.queryByRole('button', { name: 'ترک صفحه' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ماندن در صفحه' }));
    expect(router.state.location.pathname).toBe('/form');
  });

  it('تغییر فقط search همان صفحه (فیلتر) خروج نیست و پرسیده نمی‌شود', async () => {
    page.when = true;
    const user = userEvent.setup();
    const router = await renderAt();

    await user.click(screen.getByRole('link', { name: 'همین صفحه با فیلتر' }));

    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'x' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('beforeunload فقط وقتی چیزی برای از دست دادن هست، و با آخرین وضعیت صفحه', async () => {
    window.history.replaceState(null, '', '/form');
    const router = buildRouter(createBrowserHistory());
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { name: 'فرم' });

    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(unload()).toBe(false);
    // پس از تایپ، تازه‌سازی/بستن تب پرسیده می‌شود
    await userEvent.setup().click(screen.getByRole('button', { name: 'تایپ' }));
    expect(unload()).toBe(true);
  });
});
