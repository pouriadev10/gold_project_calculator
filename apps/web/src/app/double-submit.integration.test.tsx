import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRialSettlementSchema } from '@gold/contracts';
import type { SessionResponse } from '@/api/contracts';
import { createQueryClient } from '@/api/query-client';
import { routeTree, routerDefaults } from '@/app/router';
import { Toaster } from '@/components/common/Toaster';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import { contractGate } from '@/mocks/handlers/contract-gate';
import { mockError } from '@/mocks/handlers/errors';
import { partyRecords } from '@/mocks/handlers/fixtures';
import { useSessionStore } from '@/stores/session-store';
import { createIntegrationServer, IdempotencyLedger, UUID } from '@/test/integration';

/**
 * FE-100 — «یک عملیات منطقی فقط یک سند می‌سازد»، روی صفحه‌ی واقعی تسویه (`routeTree`، هوک‌ها و
 * کلاینت واقعی؛ `msw/node` تنها مرز). «سرور» همان قاعده‌ی Idempotency ِ سرور واقعی را دارد
 * (`IdempotencyLedger`: همان کلید + همان بدنه = پاسخ ذخیره‌شده؛ بدنه‌ی دیگر = ۴۰۹) و هر سند را
 * می‌شمارد. هر سناریو یکی از راه‌های ارسال دوباره است: دو ضربه‌ی هم‌زمان، Enter ِ تکراری، tap
 * سریع، تلاش دوباره پس از پاسخ گم‌شده، ترک صفحه و back/forward، و بارگذاری دوباره‌ی کل برنامه.
 * معیار هر کدام شمار سندهای «سرور» است — نه غیرفعال‌شدن دکمه.
 */

const api = createIntegrationServer();
const CASHIER: SessionResponse = {
  accessToken: 'fe100-access',
  refreshToken: 'fe100-refresh',
  expiresInSeconds: 900,
  user: { id: 'c1000000-0000-4000-8000-000000000002', email: 'cashier@example.com', displayName: 'صندوق‌دار نمونه' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
  role: 'CASHIER',
};
const PARTY = partyRecords.find((party) => party.displayName === 'حسین مرادی')!;
const PATH = `/parties/${PARTY.id}/settlements/new`;
const HEADING = `ثبت تسویه — ${PARTY.displayName}`;

/* ── «سرور» ───────────────────────────────────────────────────── */

let ledger = new IdempotencyLedger();
let loseNextResponse = false;
let rejectNext: (() => Response) | null = null;
/** وقتی تنظیم شود، پاسخ تا `release()` نگه داشته می‌شود — ضربه‌ی دوم حین ارسال اولی. */
let hold: Promise<void> | null = null;
let release: () => void = () => {};

function holdResponses() {
  hold = new Promise((resolve) => {
    release = resolve;
  });
}

const settlementServer = [
  contractGate,
  http.post('/api/parties/:partyId/settlements/rial', async ({ request }) => {
    if (hold) await hold;
    const loseResponse = loseNextResponse;
    loseNextResponse = false;
    return ledger.handle(
      request,
      (raw) => {
        if (rejectNext !== null) {
          const reject = rejectNext;
          rejectNext = null;
          return reject();
        }
        const body = createRialSettlementSchema.parse(raw);
        const sequence = String(ledger.size + 1).padStart(12, '0');
        return {
          status: 201,
          body: {
            settlementId: `d1000000-0000-4000-8000-${sequence}`,
            ledgerTransactionId: `e1000000-0000-4000-8000-${sequence}`,
            amountRial: body.amountRial,
          },
        };
      },
      { loseResponse },
    );
  }),
];

/* ── چرخه‌ی تست ───────────────────────────────────────────────── */

beforeAll(api.start);
afterAll(api.stop);
beforeEach(() => {
  api.reset();
  sessionStorage.clear();
  ledger = new IdempotencyLedger();
  loseNextResponse = false;
  rejectNext = null;
  hold = null;
  api.server.use(...settlementServer);
  useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
  useSessionStore.setState({ session: CASHIER });
});
afterEach(() => {
  release();
  cleanup();
  api.server.resetHandlers();
  useSessionStore.setState({ session: null });
});

/* ── کمک‌ها ───────────────────────────────────────────────────── */

type User = ReturnType<typeof userEvent.setup>;

/** مثل `renderRoute`، ولی router را برمی‌گرداند تا back/forward ِ تاریخچه را بشود زد. */
function renderApp(path: string) {
  const router = createRouter({ routeTree, ...routerDefaults, history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  );
  return router;
}

async function openRialForm(user: User, amount = '1000000') {
  await screen.findByRole('heading', { level: 1, name: HEADING }, { timeout: 10_000 });
  await user.click(within(screen.getByRole('radiogroup', { name: 'روش پرداخت' })).getByRole('radio', { name: /ریال/ }));
  const field = screen.getByLabelText('مبلغ');
  await user.click(field);
  await user.keyboard(amount);
  await waitFor(() => expect(field).toHaveAttribute('data-value', amount));
  await user.keyboard('{Enter}'); // بستن کیپد
}

function submitButton(): HTMLElement {
  return screen.getByRole('button', { name: 'ثبت پرداخت' });
}

async function result(): Promise<HTMLElement> {
  return screen.findByText('پرداخت ریالی ثبت شد', {}, { timeout: 10_000 });
}

function rialWrites() {
  return api.writes().filter((request) => request.path === `/api/parties/${PARTY.id}/settlements/rial`);
}

/** همه‌ی نوشتن‌ها یک کلید و بایت‌به‌بایت یک بدنه دارند — یعنی یک عملیات منطقی. */
async function expectSameOperation() {
  const writes = rialWrites();
  const keys = new Set(writes.map((request) => request.headers.get('Idempotency-Key')));
  expect(keys.size).toBe(1);
  expect([...keys][0]).toMatch(UUID);
  const bodies = new Set(await Promise.all(writes.map((request) => request.body)));
  expect(bodies.size).toBe(1);
}

/* ── سناریوها ─────────────────────────────────────────────────── */

describe('FE-100 — ارسال دوباره، یک سند', () => {
  it('دو ضربه در یک لحظه (پیش از رندر حالت غیرفعال): یک درخواست، یک سند', async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    await openRialForm(user);

    holdResponses();
    const button = submitButton();
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);
    });
    release();
    await result();

    expect(rialWrites()).toHaveLength(1);
    expect(ledger.size).toBe(1);
  });

  it('Enter ِ تکراری روی دکمه‌ی ثبت: یک سند', async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    await openRialForm(user);

    holdResponses();
    submitButton().focus();
    await user.keyboard('{Enter}{Enter}{Enter}');
    release();
    await result();

    expect(rialWrites()).toHaveLength(1);
    expect(ledger.size).toBe(1);
  });

  it('tap ِ سریع حین ارسال: دکمه «در حال ثبت…» است و ضربه‌های بعدی به سرور نمی‌رسند', async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    await openRialForm(user);

    holdResponses();
    await user.click(submitButton());
    const busy = await screen.findByRole('button', { name: 'در حال ثبت…' });
    expect(busy).toBeDisabled();
    await user.click(busy);
    await user.click(busy);
    expect(rialWrites()).toHaveLength(1);
    release();
    await result();

    expect(ledger.size).toBe(1);
  });

  it('پاسخ گم‌شده: فرم قفل می‌شود و «بررسی نتیجه» همان کلید و همان بدنه را می‌فرستد', async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    await openRialForm(user);

    loseNextResponse = true;
    await user.click(submitButton());
    expect(await screen.findByText('ارتباط با سرور برقرار نشد', {}, { timeout: 10_000 })).toBeInTheDocument();
    // «سرور» ثبت کرده؛ مرورگر خبر ندارد
    expect(ledger.size).toBe(1);
    expect(screen.getByText(/نتیجه‌ی ثبت قبلی هنوز مشخص نیست/)).toBeInTheDocument();
    expect(screen.getByLabelText('مبلغ')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'پرداخت کامل' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'بررسی نتیجه‌ی ثبت' }));
    await result();

    expect(rialWrites()).toHaveLength(2);
    await expectSameOperation();
    expect(ledger.size).toBe(1);
  });

  it('back/forward: ترک صفحه پس از پاسخ گم‌شده و برگشت، همان تلاش را برمی‌گرداند — نه کلید تازه', async () => {
    const user = userEvent.setup();
    const router = renderApp(PATH);
    await openRialForm(user);

    loseNextResponse = true;
    await user.click(submitButton());
    await screen.findByText('ارتباط با سرور برقرار نشد', {}, { timeout: 10_000 });

    // ترک: نگهبان خروج می‌پرسد چون نتیجه نامشخص است؛ کاربر ترک می‌کند
    const nav = screen.getAllByRole('navigation', { name: 'ناوبری اصلی' })[0]!;
    await user.click(within(nav).getByRole('link', { name: 'خانه' }));
    await user.click(await screen.findByRole('button', { name: 'ترک صفحه' }, { timeout: 10_000 }));
    await screen.findByRole('heading', { level: 1, name: 'مظنه بازار' }, { timeout: 10_000 });

    // back ِ مرورگر: همان صفحه، فرم تازه mount شده — فیلدها خالی‌اند ولی تلاش سنجاق‌شده برگشته
    act(() => router.history.back());
    await screen.findByRole('heading', { level: 1, name: HEADING }, { timeout: 10_000 });
    await user.click(within(screen.getByRole('radiogroup', { name: 'روش پرداخت' })).getByRole('radio', { name: /ریال/ }));
    expect(await screen.findByText(/نتیجه‌ی ثبت قبلی هنوز مشخص نیست/)).toBeInTheDocument();
    expect(screen.getByLabelText('مبلغ')).toBeDisabled();
    // رفت‌وبرگشت در تاریخچه به‌تنهایی هیچ چیزی نمی‌فرستد
    expect(rialWrites()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'بررسی نتیجه‌ی ثبت' }));
    await result();

    expect(rialWrites()).toHaveLength(2);
    await expectSameOperation();
    expect(ledger.size).toBe(1);
  });

  it('بارگذاری دوباره‌ی کل برنامه پس از پاسخ گم‌شده: همان تلاش، یک سند', async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    await openRialForm(user);

    loseNextResponse = true;
    await user.click(submitButton());
    await screen.findByText('ارتباط با سرور برقرار نشد', {}, { timeout: 10_000 });

    cleanup(); // تب تازه‌سازی شد: هیچ state ِ حافظه‌ای نمانده، فقط sessionStorage
    renderApp(PATH);
    await screen.findByRole('heading', { level: 1, name: HEADING }, { timeout: 10_000 });
    await user.click(within(screen.getByRole('radiogroup', { name: 'روش پرداخت' })).getByRole('radio', { name: /ریال/ }));
    await user.click(await screen.findByRole('button', { name: 'بررسی نتیجه‌ی ثبت' }));
    await result();

    await expectSameOperation();
    expect(ledger.size).toBe(1);
  });

  it('تلاش نامطمئن کاربر دیگر در همان تب بازیابی نمی‌شود', async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    await openRialForm(user);
    loseNextResponse = true;
    await user.click(submitButton());
    await screen.findByText('ارتباط با سرور برقرار نشد', {}, { timeout: 10_000 });

    cleanup();
    useSessionStore.setState({ session: { ...CASHIER, user: { ...CASHIER.user, id: 'c1000000-0000-4000-8000-000000000009' } } });
    renderApp(PATH);
    await openRialForm(user, '2000000');

    expect(screen.queryByText(/نتیجه‌ی ثبت قبلی هنوز مشخص نیست/)).not.toBeInTheDocument();
    expect(submitButton()).not.toBeDisabled();
  });

  it('رد قطعی سرور: فرم آزاد می‌شود، کاربر اصلاح می‌کند و فقط یک سند ساخته می‌شود', async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    await openRialForm(user);

    rejectNext = () => mockError('VALIDATION_ERROR', 'مبلغ معتبر نیست');
    await user.click(submitButton());
    expect(await screen.findByText('اطلاعات واردشده را بررسی کنید', {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(ledger.size).toBe(0);
    expect(screen.queryByText(/نتیجه‌ی ثبت قبلی هنوز مشخص نیست/)).not.toBeInTheDocument();

    const field = screen.getByLabelText('مبلغ');
    expect(field).not.toBeDisabled();
    await user.click(field);
    await user.keyboard('{Backspace>12/}2000000');
    await waitFor(() => expect(field).toHaveAttribute('data-value', '2000000'));
    await user.keyboard('{Enter}');
    await user.click(submitButton());
    await result();

    expect(ledger.size).toBe(1);
    const lastBody = JSON.parse(await rialWrites().at(-1)!.body) as { amountRial: string };
    expect(lastBody.amountRial).toBe('2000000');
  });

  it('پس از ثبت موفق، «پرداخت ریالی جدید» عملیات تازه است: کلید تازه، سند دوم', async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    await openRialForm(user);
    await user.click(submitButton());
    await result();

    await user.click(screen.getByRole('button', { name: 'پرداخت ریالی جدید' }));
    const field = screen.getByLabelText('مبلغ');
    await user.click(field);
    await user.keyboard('1000000');
    await waitFor(() => expect(field).toHaveAttribute('data-value', '1000000'));
    await user.keyboard('{Enter}');
    await user.click(submitButton());
    await result();

    const [first, second] = rialWrites();
    expect(second!.headers.get('Idempotency-Key')).not.toBe(first!.headers.get('Idempotency-Key'));
    expect(ledger.size).toBe(2);
  });
});
