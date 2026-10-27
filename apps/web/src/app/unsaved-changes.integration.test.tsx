import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionResponse } from '@/api/contracts';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import { partyRecords } from '@/mocks/handlers/fixtures';
import { usePurchaseDraftStore } from '@/stores/purchase-draft-store';
import { useSaleDraftStore } from '@/stores/sale-draft-store';
import { useSessionStore } from '@/stores/session-store';
import { createIntegrationServer, renderRoute } from '@/test/integration';

/**
 * FE-099 — هشدار خروج روی صفحه‌های واقعی برنامه (`routeTree` و پوسته‌ی ناوبری واقعی)، با `msw/node`
 * به‌عنوان تنها مرز. برای هر صفحه: فرم مثل کاربر ثبت‌نشده می‌شود، ضربه روی «خانه» ِ نوار ناوبری
 * گفت‌وگو می‌آورد، «ماندن» صفحه را نگه می‌دارد، «ترک» می‌رود — و **هیچ** نوشتنی به سرور نمی‌رود
 * (ذخیره‌ی خودکار به‌عنوان سند وجود ندارد). پس از ثبت موفق، نگهبان کنار می‌رود.
 */

const api = createIntegrationServer();
const OWNER: SessionResponse = {
  accessToken: 'fe099-access',
  refreshToken: 'fe099-refresh',
  expiresInSeconds: 900,
  user: { id: 'c1000000-0000-4000-8000-000000000002', email: 'owner@example.com', displayName: 'مالک نمونه' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
  role: 'OWNER',
};
const PARTY = partyRecords.find((party) => party.displayName === 'حسین مرادی')!;

beforeAll(api.start);
afterAll(api.stop);
beforeEach(() => {
  api.reset();
  sessionStorage.clear();
  useSaleDraftStore.getState().reset();
  usePurchaseDraftStore.getState().reset();
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
  useSessionStore.setState({ session: OWNER });
});
afterEach(() => {
  cleanup();
  api.server.resetHandlers();
  useSessionStore.setState({ session: null });
});

type User = ReturnType<typeof userEvent.setup>;

function homeLink(): HTMLElement {
  return within(screen.getAllByRole('navigation', { name: 'ناوبری اصلی' })[0]!).getByRole('link', { name: 'خانه' });
}

async function typeNumber(user: User, label: string, keys: string) {
  const field = screen.getByLabelText(label);
  await user.click(field);
  // فیلدهای ویرایشی با مقدار فعلی پر شده‌اند؛ مثل کاربر اول پاک می‌شود
  await user.keyboard(`{Backspace>12/}${keys}`);
  await waitFor(() => expect(field).toHaveAttribute('data-value', keys));
  await user.keyboard('{Enter}');
}

/**
 * ضربه روی «خانه»: گفت‌وگو با `message` می‌آید؛ «ماندن» روی همین صفحه (`heading`) نگه می‌دارد؛ ضربه‌ی
 * دوباره و «ترک» به داشبورد می‌برد. در کل این رفت‌وبرگشت هیچ درخواست نوشتنی ساخته نمی‌شود.
 */
async function expectLeaveGuarded(user: User, heading: string, message: string | RegExp) {
  const writesBefore = api.writes().length;

  await user.click(homeLink());
  const dialog = await screen.findByRole('dialog', {}, { timeout: 10_000 });
  expect(dialog).toHaveTextContent('تغییرات ثبت نشده‌اند');
  expect(dialog).toHaveTextContent(message);

  await user.click(within(dialog).getByRole('button', { name: 'ماندن در صفحه' }));
  await waitFor(() => expect(screen.queryByText('تغییرات ثبت نشده‌اند')).not.toBeInTheDocument());
  expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();

  await user.click(homeLink());
  await user.click(await screen.findByRole('button', { name: 'ترک صفحه' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'مظنه بازار' }, { timeout: 10_000 })).toBeInTheDocument();
  expect(api.writes().length).toBe(writesBefore);
}

describe('FE-099 — هشدار خروج روی صفحه‌های فرم', () => {
  it('فروش زیورآلات: پیش‌نویس در همین تب می‌ماند و خودکار ثبت نمی‌شود', async () => {
    const user = userEvent.setup();
    renderRoute('/sales/new');
    await screen.findByRole('heading', { level: 1, name: 'فروش جدید' }, { timeout: 10_000 });
    await screen.findAllByText(/منبع: /, {}, { timeout: 10_000 });
    await user.click(screen.getByRole('button', { name: 'بعدی' }));

    await expectLeaveGuarded(user, 'فروش جدید', 'پیش‌نویس فقط در همین تب نگه داشته می‌شود');
    // پیش‌نویس همان‌جا مانده؛ ترک صفحه آن را نه پاک کرد نه به سند تبدیل
    expect(useSaleDraftStore.getState().step).toBe('PARTY');
  });

  it('فروش سکه', async () => {
    const user = userEvent.setup();
    renderRoute('/sales/coins/new');
    await screen.findByRole('heading', { level: 1, name: 'فروش سکه' }, { timeout: 10_000 });
    await typeNumber(user, 'تعداد', '2');

    await expectLeaveGuarded(user, 'فروش سکه', 'اطلاعات واردشده از بین می‌رود');
  });

  it('خرید دست‌دوم (پیش‌نویس بازیابی‌شده‌ی همین تب)', async () => {
    usePurchaseDraftStore.setState({ step: 'WEIGHING', grossWeightMg: '1000' });
    const user = userEvent.setup();
    renderRoute('/purchase/second-hand');
    await screen.findByRole('heading', { level: 1, name: 'خرید طلای دست‌دوم' }, { timeout: 10_000 });

    await expectLeaveGuarded(user, 'خرید طلای دست‌دوم', 'پیش‌نویس فقط در همین تب نگه داشته می‌شود');
    expect(usePurchaseDraftStore.getState().grossWeightMg).toBe('1000');
  });

  it('خرید سکه', async () => {
    const user = userEvent.setup();
    renderRoute('/purchase/second-hand/coins');
    await screen.findAllByRole('heading', { level: 1 }, { timeout: 10_000 });
    const heading = screen.getAllByRole('heading', { level: 1 })[0]!.textContent!;
    await typeNumber(user, 'تعداد', '2');

    await expectLeaveGuarded(user, heading, 'اطلاعات واردشده از بین می‌رود');
  });

  it('تسویه: مبلغ ثبت‌نشده پرسیده می‌شود', async () => {
    const user = userEvent.setup();
    renderRoute(`/parties/${PARTY.id}/settlements/new`);
    const heading = `ثبت تسویه — ${PARTY.displayName}`;
    await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 10_000 });
    await user.click(within(screen.getByRole('radiogroup', { name: 'روش پرداخت' })).getByRole('radio', { name: /ریال/ }));
    await typeNumber(user, 'مبلغ', '1000000');

    await expectLeaveGuarded(user, heading, 'اطلاعات واردشده از بین می‌رود');
  });

  it('تسویه: پس از ثبت موفق نگهبان کنار می‌رود و خروج بی‌پرسش است', async () => {
    const user = userEvent.setup();
    renderRoute(`/parties/${PARTY.id}/settlements/new`);
    await screen.findByRole('heading', { level: 1, name: `ثبت تسویه — ${PARTY.displayName}` }, { timeout: 10_000 });
    await user.click(within(screen.getByRole('radiogroup', { name: 'روش پرداخت' })).getByRole('radio', { name: /ریال/ }));
    await typeNumber(user, 'مبلغ', '1000000');
    await user.click(screen.getByRole('button', { name: 'ثبت پرداخت' }));
    await screen.findByText('پرداخت ریالی ثبت شد', {}, { timeout: 10_000 });

    await user.click(homeLink());
    expect(await screen.findByRole('heading', { level: 1, name: 'مظنه بازار' }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.queryByText('تغییرات ثبت نشده‌اند')).not.toBeInTheDocument();
  });

  it('تنظیمات عمومی: مقدار تازه‌ی ذخیره‌نشده پرسیده می‌شود', async () => {
    const user = userEvent.setup();
    renderRoute('/settings/general');
    await screen.findByRole('heading', { level: 1, name: 'تنظیمات عمومی' }, { timeout: 10_000 });
    await user.click(await screen.findByRole('button', { name: 'تغییر واحد گرد کردن' }, { timeout: 10_000 }));
    await typeNumber(user, 'واحد گرد کردن جدید', '5000');

    await expectLeaveGuarded(user, 'تنظیمات عمومی', 'اطلاعات واردشده از بین می‌رود');
  });

  it('M-29 (#43): مظنه‌ی دستی ِ ثبت‌نشده پرسیده می‌شود', async () => {
    const user = userEvent.setup();
    renderRoute('/pricing');
    await screen.findByRole('heading', { level: 1, name: 'مظنه' }, { timeout: 10_000 });
    await typeNumber(user, 'مظنه مثقال', '412000000');

    await expectLeaveGuarded(user, 'مظنه', 'اطلاعات واردشده از بین می‌رود');
  });

  it('صفحه‌ی فرم بدون هیچ ورودی: خروج بی‌پرسش', async () => {
    const user = userEvent.setup();
    renderRoute('/sales/coins/new');
    await screen.findByRole('heading', { level: 1, name: 'فروش سکه' }, { timeout: 10_000 });

    await user.click(homeLink());

    expect(await screen.findByRole('heading', { level: 1, name: 'مظنه بازار' }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
