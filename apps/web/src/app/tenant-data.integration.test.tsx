import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Party, SessionResponse } from '@/api/contracts';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import { DATA_OWNER_STORAGE_KEY, TAB_DATA_OWNER_STORAGE_KEY } from '@/lib/tenant-data';
import { contractGate } from '@/mocks/handlers/contract-gate';
import { partyRecords } from '@/mocks/handlers/fixtures';
import { usePurchaseDraftStore } from '@/stores/purchase-draft-store';
import { RECENT_PARTIES_STORAGE_KEY, useRecentPartiesStore } from '@/stores/recent-parties-store';
import { useSaleDraftStore } from '@/stores/sale-draft-store';
import { SESSION_STORAGE_KEY, useSessionStore } from '@/stores/session-store';
import { createIntegrationServer, renderRoute } from '@/test/integration';

/**
 * FE-101 — «logout cache tenant را پاک کند» و «ورود tenant دیگر داده‌ی قبلی را نشان ندهد»، روی
 * برنامه‌ی واقعی (`routeTree`، صفحه‌ی ورود، دکمه‌ی خروج تنظیمات، انتخابگر شخص، فهرست اشخاص) با
 * `msw/node`. دو فروشگاه با یک مرورگر: «سرور» اشخاص هر فروشگاه را از روی توکن جدا برمی‌گرداند.
 */

const api = createIntegrationServer();

function sessionFor(tenant: 'a' | 'b'): SessionResponse {
  return {
    accessToken: `token-${tenant}`,
    refreshToken: `refresh-${tenant}`,
    expiresInSeconds: 900,
    user: { id: `user-${tenant}`, email: `${tenant}@example.com`, displayName: `کاربر ${tenant}` },
    tenant: { id: `tenant-${tenant}`, slug: `shop-${tenant}`, name: `فروشگاه ${tenant}`, timezone: 'Asia/Tehran' },
    role: 'OWNER',
  };
}

const TEMPLATE = partyRecords.find((party) => party.status === 'ACTIVE' && party.type === 'CONSUMER')!;
const PARTY_A: Party = { ...TEMPLATE, id: 'aa000000-0000-4000-8000-000000000001', displayName: 'مشتری فروشگاه الف' };
const PARTY_B: Party = { ...TEMPLATE, id: 'bb000000-0000-4000-8000-000000000001', displayName: 'مشتری فروشگاه ب' };

const tenantServer = [
  contractGate,
  http.post('/api/auth/login', async ({ request }) => {
    const body = (await request.json()) as { tenantSlug: string };
    if (body.tenantSlug === 'shop-a') return HttpResponse.json(sessionFor('a'));
    if (body.tenantSlug === 'shop-b') return HttpResponse.json(sessionFor('b'));
    return HttpResponse.json({ code: 'UNAUTHORIZED', message: 'نادرست', fields: {} }, { status: 401 });
  }),
  http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/parties', ({ request }) => {
    const party = request.headers.get('Authorization') === 'Bearer token-a' ? PARTY_A : PARTY_B;
    return HttpResponse.json({ items: [party], total: 1, limit: 20, offset: 0 });
  }),
];

beforeAll(api.start);
afterAll(api.stop);
beforeEach(() => {
  api.reset();
  sessionStorage.clear();
  localStorage.removeItem(DATA_OWNER_STORAGE_KEY);
  useRecentPartiesStore.getState().clear();
  useSaleDraftStore.getState().reset();
  usePurchaseDraftStore.getState().reset();
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
  useSessionStore.setState({ session: null });
  api.server.use(...tenantServer);
});
afterEach(() => {
  cleanup();
  api.server.resetHandlers();
  useSessionStore.setState({ session: null });
});

type User = ReturnType<typeof userEvent.setup>;

async function login(user: User, tenant: 'a' | 'b') {
  await screen.findByRole('heading', { level: 1, name: 'ورود به حساب طلا' }, { timeout: 10_000 });
  await user.type(screen.getByLabelText('ایمیل'), `${tenant}@example.com`);
  await user.type(screen.getByLabelText('رمز عبور'), 'secret-password');
  await user.type(screen.getByLabelText('شناسه‌ی فروشگاه'), `shop-${tenant}`);
  await user.click(screen.getByRole('button', { name: 'ورود' }));
  await screen.findByRole('heading', { level: 1, name: 'مظنه بازار' }, { timeout: 10_000 });
}

function navLink(name: string): HTMLElement {
  return within(screen.getAllByRole('navigation', { name: 'ناوبری اصلی' })[0]!).getByRole('link', { name });
}

/** فهرست اشخاص: فروشگاه جاری را از سرور می‌خواند و هرگز، حتی یک لحظه، شخص فروشگاه دیگر را نشان نمی‌دهد. */
async function expectPartyListOf(user: User, mine: Party, other: Party) {
  await user.click(navLink('اشخاص'));
  // همان لحظه‌ی رندر — اگر کش قبلی مانده بود، اینجا (پیش از پاسخ سرور) دیده می‌شد
  expect(screen.queryByText(other.displayName)).not.toBeInTheDocument();
  expect(await screen.findByText(mine.displayName, {}, { timeout: 10_000 })).toBeInTheDocument();
  expect(screen.queryByText(other.displayName)).not.toBeInTheDocument();
}

/** انتخابگر شخص ِ جادوگر فروش، بدون جست‌وجو: فهرست «اخیر» همین مرورگر. */
async function openSalePartySelector(user: User) {
  await user.click(navLink('فروش'));
  await screen.findByRole('heading', { level: 1, name: 'فروش جدید' }, { timeout: 10_000 });
  await screen.findAllByText(/منبع: /, {}, { timeout: 10_000 });
  const next = screen.getByRole('button', { name: 'بعدی' });
  await waitFor(() => expect(next).not.toBeDisabled());
  await user.click(next);
  await user.click(screen.getByLabelText('مشتری'));
  return screen.findByRole('dialog', {}, { timeout: 10_000 });
}

describe('FE-101 — داده‌ی فروشگاه قبلی', () => {
  it('خروج همه‌چیز را پاک می‌کند و ورود فروشگاه دیگر هیچ داده‌ی فروشگاه قبلی را نشان نمی‌دهد', async () => {
    const user = userEvent.setup();
    renderRoute('/login');
    await login(user, 'a');
    await expectPartyListOf(user, PARTY_A, PARTY_B);

    // فروشنده‌ی الف مشتری‌اش را در فروش انتخاب کرده و پیش‌نویس نیمه‌کاره دارد
    const dialogA = await openSalePartySelector(user);
    await user.type(within(dialogA).getByLabelText('جست‌وجوی نام یا موبایل'), 'مشتری');
    await user.click(await within(dialogA).findByText(PARTY_A.displayName, {}, { timeout: 10_000 }));
    await waitFor(() => expect(useSaleDraftStore.getState().party?.id).toBe(PARTY_A.id));
    expect(useRecentPartiesStore.getState().recent.map((party) => party.id)).toEqual([PARTY_A.id]);

    // خروج از تنظیمات (نگهبان پیش‌نویس فروش «ترک» را می‌پرسد)
    await user.click(navLink('تنظیمات'));
    const leave = await screen.findByRole('button', { name: 'ترک صفحه' }, { timeout: 10_000 }).catch(() => null);
    if (leave) await user.click(leave);
    await user.click(await screen.findByRole('button', { name: 'خروج' }, { timeout: 10_000 }));
    await screen.findByRole('heading', { level: 1, name: 'ورود به حساب طلا' }, { timeout: 10_000 });

    expect(document.body.textContent).not.toContain(PARTY_A.displayName);
    expect(useRecentPartiesStore.getState().recent).toEqual([]);
    expect(useSaleDraftStore.getState().party).toBeNull();
    expect(localStorage.getItem(DATA_OWNER_STORAGE_KEY)).toBeNull();

    // فروشگاه ب در همین مرورگر
    await login(user, 'b');
    await expectPartyListOf(user, PARTY_B, PARTY_A);
    const dialogB = await openSalePartySelector(user);
    expect(within(dialogB).queryByText(PARTY_A.displayName)).not.toBeInTheDocument();
    expect(within(dialogB).getByText(/هنوز شخصی اخیراً انتخاب نشده/)).toBeInTheDocument();
    expect(localStorage.getItem(DATA_OWNER_STORAGE_KEY)).toBe('tenant-b:user-b');
  }, 60_000);

  it('نشست منقضی (بی خروج) و ورود فروشگاه دیگر: پیش‌نویس و «اخیر» ِ قبلی پیش از نشست تازه پاک می‌شوند', async () => {
    // وضعیت مرورگری که فروشگاه الف در آن کار می‌کرد و نشستش منقضی شد — هیچ خروج عمدی‌ای نبود
    localStorage.setItem(DATA_OWNER_STORAGE_KEY, 'tenant-a:user-a');
    const pickedA = { id: PARTY_A.id, displayName: PARTY_A.displayName, mobile: null, type: PARTY_A.type, status: PARTY_A.status };
    useRecentPartiesStore.setState({ recent: [pickedA] });
    useSaleDraftStore.setState({ party: pickedA });

    const user = userEvent.setup();
    renderRoute('/login?reason=expired');
    await login(user, 'b');

    expect(useRecentPartiesStore.getState().recent).toEqual([]);
    expect(useSaleDraftStore.getState().party).toBeNull();
    const dialog = await openSalePartySelector(user);
    expect(within(dialog).queryByText(PARTY_A.displayName)).not.toBeInTheDocument();
  }, 60_000);

  it('همان کاربر پس از انقضا دوباره وارد می‌شود: پیش‌نویسش سر جایش است', async () => {
    localStorage.setItem(DATA_OWNER_STORAGE_KEY, 'tenant-a:user-a');
    const pickedA = { id: PARTY_A.id, displayName: PARTY_A.displayName, mobile: null, type: PARTY_A.type, status: PARTY_A.status };
    useRecentPartiesStore.setState({ recent: [pickedA] });

    const user = userEvent.setup();
    renderRoute('/login?reason=expired');
    await login(user, 'a');

    const dialog = await openSalePartySelector(user);
    expect(within(dialog).getByText(PARTY_A.displayName)).toBeInTheDocument();
  }, 60_000);
});

/* ── FE-102: تعویض مستأجر زیر پای یک تب باز ─────────────────────────── */

/**
 * «تب دیگر» با فروشگاه ب وارد شد: همان کاری که `LoginPage` در آن تب می‌کند (`claimTenantData`
 * مالک مشترک را ب می‌کند و داده‌ی مشترک را پاک) و نشست تازه در `localStorage`؛ این تب فقط رویداد
 * `storage` می‌بیند — بی هیچ خروجی.
 */
function loginInOtherTab(tenant: 'a' | 'b') {
  const next = sessionFor(tenant);
  localStorage.setItem(DATA_OWNER_STORAGE_KEY, `tenant-${tenant}:user-${tenant}`);
  localStorage.setItem(RECENT_PARTIES_STORAGE_KEY, JSON.stringify({ state: { recent: [] }, version: 0 }));
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ state: { session: next }, version: 0 }));
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: SESSION_STORAGE_KEY }));
  });
}

/** هر درخواستی که با توکن ب رفته و شناسه‌ی داده‌ی الف را در خود دارد — نباید هیچ باشد. */
function crossTenantRequests() {
  return api
    .requests()
    .filter((request) => request.headers.get('Authorization') === 'Bearer token-b')
    .filter((request) => request.path.includes(PARTY_A.id));
}

describe('FE-102 — تعویض مستأجر در تب دیگر', () => {
  it('ورود فروشگاه ب در تب دیگر: بی‌فلش، پیش‌نویس الف پاک، مسیر امن بدون پرسش ترک، و اعلان', async () => {
    const user = userEvent.setup();
    renderRoute('/login');
    await login(user, 'a');
    await expectPartyListOf(user, PARTY_A, PARTY_B);

    // پیش‌نویس فروش الف با مشتری الف — نگهبان ترک فعال است
    const pickedA = { id: PARTY_A.id, displayName: PARTY_A.displayName, mobile: null, type: PARTY_A.type, status: PARTY_A.status };
    useRecentPartiesStore.setState({ recent: [pickedA] });
    act(() => useSaleDraftStore.setState({ party: pickedA, step: 'PARTY' }));
    await user.click(navLink('فروش'));
    await screen.findByRole('heading', { level: 1, name: 'فروش جدید' }, { timeout: 10_000 });
    expect(screen.getByLabelText('مشتری')).toHaveTextContent(PARTY_A.displayName);

    loginInOtherTab('b');

    // همان رندر: صفحه‌ی الف رفته، داده‌ی الف هیچ‌جا
    expect(document.body.textContent).not.toContain(PARTY_A.displayName);
    expect(await screen.findByText('حساب فعال عوض شد', {}, { timeout: 10_000 })).toBeInTheDocument();
    await screen.findByRole('heading', { level: 1, name: 'مظنه بازار' }, { timeout: 10_000 });
    expect(screen.queryByText('تغییرات ثبت نشده‌اند')).not.toBeInTheDocument();

    expect(useSaleDraftStore.getState().party).toBeNull();
    expect(useRecentPartiesStore.getState().recent).toEqual([]);
    expect(sessionStorage.getItem(TAB_DATA_OWNER_STORAGE_KEY)).toBe('tenant-b:user-b');

    await expectPartyListOf(user, PARTY_B, PARTY_A);
    const dialog = await openSalePartySelector(user);
    expect(within(dialog).queryByText(PARTY_A.displayName)).not.toBeInTheDocument();
    expect(crossTenantRequests()).toEqual([]);
  }, 60_000);

  it('تب با پیش‌نویس کاربر دیگر به برنامه برمی‌گردد (پس از خروج و ورود در تب دیگر): پیش از نمایش پاک می‌شود', async () => {
    // این تب برای الف کار می‌کرد؛ نشست حالا مال ب است (تب دیگر)، پیش‌نویس الف در sessionStorage ِ این تب
    const pickedA = { id: PARTY_A.id, displayName: PARTY_A.displayName, mobile: null, type: PARTY_A.type, status: PARTY_A.status };
    sessionStorage.setItem(TAB_DATA_OWNER_STORAGE_KEY, 'tenant-a:user-a');
    localStorage.setItem(DATA_OWNER_STORAGE_KEY, 'tenant-b:user-b');
    useSaleDraftStore.setState({ party: pickedA, step: 'PARTY' });
    useSessionStore.setState({ session: sessionFor('b') });

    renderRoute('/sales/new');
    expect(document.body.textContent).not.toContain(PARTY_A.displayName);
    await screen.findByRole('heading', { level: 1, name: 'فروش جدید' }, { timeout: 10_000 });

    expect(document.body.textContent).not.toContain(PARTY_A.displayName);
    expect(useSaleDraftStore.getState().party).toBeNull();
    expect(sessionStorage.getItem(TAB_DATA_OWNER_STORAGE_KEY)).toBe('tenant-b:user-b');
    // ورود به برنامه، نه تعویض زنده — مسیری که کاربر خواسته حفظ می‌شود و اعلانی نیست
    expect(screen.queryByText('حساب فعال عوض شد')).not.toBeInTheDocument();
  }, 60_000);

  it('تمدید نشست (همان کاربر، توکن تازه) هیچ چیز را پاک یا جابه‌جا نمی‌کند', async () => {
    const user = userEvent.setup();
    renderRoute('/login');
    await login(user, 'a');
    const pickedA = { id: PARTY_A.id, displayName: PARTY_A.displayName, mobile: null, type: PARTY_A.type, status: PARTY_A.status };
    act(() => useSaleDraftStore.setState({ party: pickedA, step: 'PARTY' }));
    await user.click(navLink('فروش'));
    await screen.findByRole('heading', { level: 1, name: 'فروش جدید' }, { timeout: 10_000 });

    act(() => useSessionStore.setState({ session: { ...sessionFor('a'), accessToken: 'token-a-2' } }));

    expect(screen.getByRole('heading', { level: 1, name: 'فروش جدید' })).toBeInTheDocument();
    expect(screen.getByLabelText('مشتری')).toHaveTextContent(PARTY_A.displayName);
    expect(useSaleDraftStore.getState().party?.id).toBe(PARTY_A.id);
    expect(screen.queryByText('حساب فعال عوض شد')).not.toBeInTheDocument();
  }, 60_000);
});
