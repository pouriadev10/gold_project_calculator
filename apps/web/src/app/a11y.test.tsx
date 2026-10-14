import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionResponse } from '@/api/contracts';
import { createQueryClient } from '@/api/query-client';
import { routeTree, routerDefaults } from '@/app/router';
import { Toaster } from '@/components/common/Toaster';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import { handlers } from '@/mocks/handlers';
import { salesInvoiceRecords } from '@/mocks/handlers/fixtures';
import { useSessionStore } from '@/stores/session-store';

/**
 * ممیزی خودکار دسترس‌پذیری صفحات اصلی با axe-core — FE-084.
 *
 * صفحه‌ها با همان درخت مسیر واقعی (`routeTree`)، پوسته‌ی ناوبری و همان
 * handlerهای MSW توسعه رندر می‌شوند، نه با hookهای mock‌شده؛ پس axe همان
 * DOMی را می‌بیند که کاربر می‌بیند. معیار تسک «خطای جدی» است: هر نقض با
 * اثر `serious` یا `critical` تست را می‌شکند.
 *
 * `color-contrast` در jsdom قابل اندازه‌گیری نیست (رنگ محاسبه‌شده و چیدمان
 * ندارد)؛ کنتراست توکن‌ها در design-system/MASTER.md بخش ۱ اندازه‌گیری شده و
 * در `docs/a11y-audit.md` ثبت است.
 */

const server = setupServer(...handlers);
const PARTY_ID = 'a1000000-0000-4000-8000-000000000001';
const INVOICE_ID = salesInvoiceRecords[0]!.id;

function session(role: SessionResponse['role']): SessionResponse {
  return {
    accessToken: 'a11y-access',
    refreshToken: 'a11y-refresh',
    expiresInSeconds: 900,
    user: { id: 'c1000000-0000-4000-8000-000000000002', email: 'owner@example.com', displayName: 'مالک نمونه' },
    tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
    role,
  };
}

const originalFetch = globalThis.fetch;
// jsdom `scrollTo` را پیاده نمی‌کند؛ router هنگام ناوبری صدایش می‌زند.
window.scrollTo = () => undefined;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  // fetch در Node آدرس نسبی (`/api/...`) را نمی‌پذیرد؛ مرورگر آن را نسبت به origin حل می‌کند.
  // `AbortSignal` ساخت jsdom هم برای fetch خودِ Node ناشناخته است و درخواست را رد می‌کند؛
  // اینجا فقط برای timeout است و در ممیزی لازم نیست.
  const mswFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const { signal: _signal, ...rest } = init ?? {};
    return mswFetch(typeof input === 'string' && input.startsWith('/') ? new URL(input, window.location.origin) : input, rest);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  server.close();
});

beforeEach(() => {
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  useSessionStore.setState({ session: null });
});

function renderAt(path: string) {
  const router = createRouter({ routeTree, ...routerDefaults, history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  );
  return router;
}

async function seriousViolations(): Promise<string[]> {
  const results = await axe.run(document.body, {
    rules: { 'color-contrast': { enabled: false } },
    resultTypes: ['violations'],
  });
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n  ${violation.nodes
          .slice(0, 5)
          .map((node) => node.target.join(' '))
          .join('\n  ')}`,
    );
}

/** `heading`: عنوان h1 صفحه؛ `content`: متنی که فقط پس از رسیدن داده‌ی واقعی دیده می‌شود. */
const PAGES: ReadonlyArray<{ path: string; heading: string; content: string | RegExp }> = [
  { path: '/dashboard', heading: 'مظنه بازار', content: 'آخرین معامله‌ها' },
  { path: '/sales/new', heading: 'فروش جدید', content: /منبع: / },
  { path: '/sales/coins/new', heading: 'فروش سکه', content: /نوع سکه/ },
  { path: '/sales/invoices', heading: 'فاکتورهای فروش', content: /صفحه/ },
  { path: `/sales/invoices/${INVOICE_ID}`, heading: 'جزئیات فاکتور', content: /اقلام/ },
  { path: '/purchase/second-hand', heading: 'خرید طلای دست‌دوم', content: /فروشنده/ },
  { path: '/parties', heading: 'اشخاص', content: 'حسین مرادی' },
  { path: `/parties/${PARTY_ID}`, heading: 'حسین مرادی', content: /مانده/ },
  { path: `/parties/${PARTY_ID}/statement`, heading: 'صورت‌حساب حسین مرادی', content: /مانده/ },
  { path: '/inventory/coins', heading: 'موجودی سکه', content: /نیم سکه/ },
  { path: '/pricing', heading: 'مظنه', content: 'منبع فعال: دستی' },
  { path: '/reporting/debtors', heading: 'بدهکاران', content: /حسین مرادی/ },
  { path: '/reporting/profit', heading: 'گزارش سود', content: /سود/ },
  { path: '/settings', heading: 'بیشتر', content: 'واحد نمایش' },
  { path: '/settings/general', heading: 'تنظیمات عمومی', content: 'واحد گرد کردن' },
  { path: '/settings/coin-types', heading: 'انواع سکه', content: 'نیم سکه' },
];

describe('axe — main pages have no serious accessibility violations (FE-084)', () => {
  it('login', async () => {
    renderAt('/login');
    await screen.findByRole('button', { name: /ورود/ });
    expect(await seriousViolations()).toEqual([]);
  });

  it.each(PAGES)('$path', async ({ path, heading, content }) => {
    useSessionStore.setState({ session: session('OWNER') });
    renderAt(path);
    await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 4000 });
    await screen.findAllByText(content, {}, { timeout: 4000 });
    expect(screen.queryByText(/ناموفق بود/)).toBeNull();
    // تا داده‌ها برسند و skeletonها جای خود را به محتوا بدهند.
    await waitFor(() => expect(document.querySelector('[aria-label^="در حال دریافت"]')).toBeNull(), { timeout: 4000 });
    expect(await seriousViolations()).toEqual([]);
  });
});

/**
 * «flow فروش با کیبورد قابل انجام باشد» — FE-084. فروش سکه از ابتدا تا رسید فقط
 * با Tab، Enter، کلیدهای جهت و رقم‌ها. `tabTo` با Tab زدن به عنصر می‌رسد و اگر
 * نرسد تست می‌شکند؛ یعنی هر کنترل واقعاً در ترتیب فوکوس است.
 */
describe('keyboard-only sale flow (FE-084)', () => {
  async function tabTo(user: ReturnType<typeof userEvent.setup>, target: HTMLElement, max = 80): Promise<void> {
    for (let step = 0; step < max; step += 1) {
      if (document.activeElement === target) return;
      await user.tab();
    }
    throw new Error(`با ${max} بار Tab به «${target.getAttribute('aria-label') ?? target.textContent ?? target.id}» نرسید`);
  }

  it('a coin sale can be completed with the keyboard alone', async () => {
    const user = userEvent.setup();
    useSessionStore.setState({ session: session('CASHIER') });
    renderAt('/sales/coins/new');
    await screen.findByRole('heading', { level: 1, name: 'فروش سکه' }, { timeout: 4000 });
    await screen.findAllByRole('option', { name: /نیم سکه/ }, { timeout: 4000 });

    // مشتری: combobox با Enter باز، جست‌وجو تایپ، ↓ و Enter انتخاب.
    await tabTo(user, screen.getByLabelText('مشتری'));
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    // فوکوس داخل Bottom Sheet مودال می‌رود، نه پشتش روی دکمه.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await tabTo(user, screen.getByLabelText('جست‌وجوی نام یا موبایل'));
    await user.keyboard('حسین');
    await screen.findByRole('option', { name: /حسین مرادی/ }, { timeout: 4000 });
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(screen.getByLabelText('مشتری')).toHaveTextContent('حسین مرادی'));

    // نوع سکه: select بومی؛ مرورگر خودش آن را با کیبورد کنترل می‌کند.
    const coinType = screen.getByLabelText('نوع سکه');
    await tabTo(user, coinType);
    fireEvent.change(coinType, { target: { value: (coinType as HTMLSelectElement).options[1]!.value } });

    // تعداد و قیمت: رقم‌های کیبورد فیزیکی به فیلد فوکوس‌شده می‌روند.
    await tabTo(user, screen.getByLabelText('تعداد'));
    await user.keyboard('2');
    await tabTo(user, screen.getByLabelText('قیمت واحد بازار'));
    await user.keyboard('400000000');
    expect(screen.getByLabelText('تعداد')).toHaveAttribute('data-value', '2');
    expect(screen.getByLabelText('قیمت واحد بازار')).toHaveAttribute('data-value', '400000000');

    await tabTo(user, screen.getByRole('button', { name: 'پرداخت کامل' }));
    await user.keyboard('{Enter}');

    await tabTo(user, screen.getByRole('button', { name: 'ثبت فروش' }));
    await user.keyboard('{Enter}');

    expect(await screen.findByText(/فاکتور شماره .* ثبت شد/, {}, { timeout: 4000 })).toBeInTheDocument();
  }, 30000);

  it('a jewelry sale (the wizard) can be completed with the keyboard alone', async () => {
    const user = userEvent.setup();
    sessionStorage.clear();
    useSessionStore.setState({ session: session('CASHIER') });
    renderAt('/sales/new');
    await screen.findByRole('heading', { level: 1, name: 'فروش جدید' }, { timeout: 4000 });
    await screen.findAllByText(/منبع: /, {}, { timeout: 4000 });

    const next = async () => {
      const button = screen.getByRole('button', { name: 'بعدی' });
      await waitFor(() => expect(button).not.toBeDisabled());
      await tabTo(user, button);
      await user.keyboard('{Enter}');
    };

    await next(); // مظنه → مشتری
    await tabTo(user, await screen.findByLabelText('مشتری'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true));
    await tabTo(user, screen.getByLabelText('جست‌وجوی نام یا موبایل'));
    await user.keyboard('حسین');
    await screen.findByRole('option', { name: /حسین مرادی/ }, { timeout: 4000 });
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await next(); // مشتری → اقلام
    await tabTo(user, await screen.findByRole('button', { name: 'افزودن کالا' }));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true));
    await tabTo(user, screen.getByLabelText('جست‌وجوی کد یا عنوان'));
    await user.keyboard('انگشتر');
    await screen.findAllByRole('option', { name: /انگشتر/ }, { timeout: 4000 });
    await user.keyboard('{ArrowDown}{Enter}');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // قیمت‌گذاری قلم: مشخصات از کاتالوگ پر شده‌اند؛ فقط «ذخیره».
    await tabTo(user, await screen.findByRole('button', { name: /^ویرایش قیمت / }));
    await user.keyboard('{Enter}');
    const save = await screen.findByRole('button', { name: 'ذخیره' }, { timeout: 4000 });
    await waitFor(() => expect(save).not.toBeDisabled(), { timeout: 4000 });
    await tabTo(user, save);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('قیمت‌گذاری نشده')).toBeNull();

    // باقی مرحله‌ها تا «مرور و ثبت».
    for (let guard = 0; guard < 4 && !screen.queryByRole('button', { name: 'ثبت فروش' }); guard += 1) {
      await next();
    }

    await tabTo(user, await screen.findByRole('button', { name: 'پرداخت کامل' }));
    await user.keyboard('{Enter}');
    const submit = screen.getByRole('button', { name: 'ثبت فروش' });
    await waitFor(() => expect(submit).not.toBeDisabled(), { timeout: 4000 });
    await tabTo(user, submit);
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('heading', { level: 1, name: 'فروش ثبت شد' }, { timeout: 4000 })).toBeInTheDocument();
  }, 30000);
});
