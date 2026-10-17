import { useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@/api/contracts';
import { CountInput } from '@/components/keypad/CountInput';
import { NumericKeypad } from '@/components/keypad/NumericKeypad';
import { useKeypadStore } from '@/components/keypad/keypad-store';
import { salesInvoiceRecords } from '@/mocks/handlers/fixtures';
import { usePurchaseDraftStore } from '@/stores/purchase-draft-store';
import { useSaleDraftStore } from '@/stores/sale-draft-store';
import { useSessionStore } from '@/stores/session-store';
import { useToastStore } from '@/stores/toast-store';
import { createIntegrationServer, renderRoute } from '@/test/integration';

/**
 * FE-105 — قانون سکه در فرانت (بخش‌های ۲-۲، ۲-۳ و ۵ CLAUDE.md).
 *
 * ۱. **ایستا، روی کل `src`** (بدون تست‌ها و mock): نگاشت نسخه‌ی کاتالوگ به `CoinType` (که تنها
 *    راه رسیدن به `bubble()` است) فقط یک‌جا تعریف می‌شود؛ هیچ‌جا پرچم حباب ثابت `true` نمی‌شود؛
 *    هیچ نوع/شاخه‌ی شمش در کد برنامه نیست؛ و وزن سکه با تقسیم صحیح (گرد کردن پنهان) ساخته نمی‌شود.
 * ۲. **رندر واقعی همه‌ی صفحه‌ها:** کلمه‌ی «شمش» (یا bullion) در هیچ صفحه‌ای دیده نمی‌شود — شمش
 *    در UI فاز ۱ اصلاً وجود ندارد، حتی به‌عنوان توضیح.
 * ۳. **تعداد صحیح:** فیلد تعداد جداکننده‌ی اعشار را نمی‌پذیرد.
 *
 * «حباب فقط برای سکه‌ی بانک مرکزی» در هر صفحه‌ی سکه جداگانه با یک نوع خصوصی آزموده شده است
 * (فروش، خرید، تسویه، موجودی، تنظیمات) و `lib/coin-type.test.ts` نگاشت مشترک را می‌سنجد.
 */

vi.mock('@/features/reporting/profit-trend-echarts', () => ({
  renderTrendChart: () => ({
    update: () => undefined,
    resize: () => undefined,
    dispose: () => undefined,
  }),
}));

const SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** کد برنامه — بدون تست‌ها، mock ِ توسعه و زیرساخت آزمون. */
const APP_SOURCES = Object.entries(SOURCES).filter(
  ([path]) =>
    !/\.test\.tsx?$/u.test(path) &&
    !path.startsWith('/src/mocks/') &&
    !path.startsWith('/src/test/'),
);

/** کامنت‌ها حذف می‌شوند تا توضیح قاعده (مثلاً «شمش حباب ندارد» در JSDoc) جای کد شمرده نشود. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1');
}

function filesMatching(pattern: RegExp): string[] {
  return APP_SOURCES.filter(([, source]) => pattern.test(withoutComments(source))).map(
    ([path]) => path,
  );
}

describe('FE-105 — قانون سکه در کد برنامه (ایستا)', () => {
  it('کد برنامه واقعاً اسکن می‌شود', () => {
    expect(APP_SOURCES.length).toBeGreaterThan(100);
    expect(APP_SOURCES.map(([path]) => path)).toContain('/src/lib/coin-type.ts');
  });

  it('نگاشت نسخه‌ی کاتالوگ به CoinType فقط یک‌جاست (lib/coin-type.ts)', () => {
    expect(filesMatching(/function\s+toCoinType\s*\(|const\s+toCoinType\s*=/u)).toEqual([
      '/src/lib/coin-type.ts',
    ]);
  });

  it('پرچم حباب هیچ‌جا ثابت true نمی‌شود — فقط از خود نسخه‌ی کاتالوگ می‌آید', () => {
    expect(filesMatching(/isCentralBankMinted\s*:\s*true/u)).toEqual(['/src/lib/coin-type.ts']);
    // و همان‌جا هم فقط پشت شرط خود نسخه
    expect(SOURCES['/src/lib/coin-type.ts']).toMatch(
      /version\.isCentralBankMinted\s*\?\s*\{\s*\.\.\.shared,\s*isCentralBankMinted:\s*true\s*\}/u,
    );
  });

  it('هیچ نوع یا شاخه‌ی شمش در کد برنامه نیست', () => {
    expect(filesMatching(/BullionType|kind:\s*'bullion'|'BULLION'|"BULLION"/u)).toEqual([]);
  });

  it('وزن سکه با تقسیم صحیح ساخته نمی‌شود (گرد کردن پنهان بیرون از rounding.ts)', () => {
    expect(filesMatching(/grossWeightUg\)*\s*\/\s*1000n/u)).toEqual([]);
  });
});

const api = createIntegrationServer();
const PARTY_ID = 'a1000000-0000-4000-8000-000000000001';
const INVOICE_ID = salesInvoiceRecords[0]!.id;

const OWNER: SessionResponse = {
  accessToken: 'coin-access',
  refreshToken: 'coin-refresh',
  expiresInSeconds: 900,
  user: {
    id: 'c1000000-0000-4000-8000-000000000002',
    email: 'owner@example.com',
    displayName: 'مالک نمونه',
  },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
  role: 'OWNER',
};

/** همه‌ی صفحه‌های فاز ۱ — `heading`: عنوان h1 که پس از بارگذاری مسیر دیده می‌شود. */
const PAGES: ReadonlyArray<{
  path: string;
  heading: string | RegExp;
  /** تا بخش‌هایی که فقط با داده رندر می‌شوند (مثل ریز و پانویس سود) هم سنجیده شوند. */
  prepare?: (user: ReturnType<typeof userEvent.setup>) => Promise<void>;
}> = [
  { path: '/dashboard', heading: 'مظنه بازار' },
  { path: '/sales/new', heading: 'فروش جدید' },
  { path: '/sales/coins/new', heading: 'فروش سکه' },
  { path: '/sales/invoices', heading: 'فاکتورهای فروش' },
  { path: `/sales/invoices/${INVOICE_ID}`, heading: 'جزئیات فاکتور' },
  { path: `/sales/invoices/${INVOICE_ID}/b2c-buyback`, heading: 'مقایسه خرید مجدد مشتری' },
  { path: '/purchase/second-hand', heading: 'خرید طلای دست‌دوم' },
  { path: '/purchase/second-hand/coins', heading: /خرید سکه/u },
  { path: '/parties', heading: 'اشخاص' },
  { path: `/parties/${PARTY_ID}`, heading: 'حسین مرادی' },
  { path: `/parties/${PARTY_ID}/statement`, heading: 'صورت‌حساب حسین مرادی' },
  { path: `/parties/${PARTY_ID}/settlements/new`, heading: /^ثبت تسویه/u },
  { path: '/inventory', heading: /موجودی/u },
  { path: '/inventory/jewelry', heading: /زیورآلات|مصنوعات/u },
  { path: '/inventory/coins', heading: 'موجودی سکه' },
  { path: '/inventory/opening-balance', heading: /موجودی افتتاحیه/u },
  { path: '/pricing', heading: 'مظنه' },
  { path: '/reporting/debtors', heading: 'بدهکاران' },
  { path: '/reporting/creditors', heading: 'بستانکاران' },
  {
    path: '/reporting/profit',
    heading: 'گزارش سود',
    // «این ماه» در داده‌ی mock خالی است؛ «کل دوره» ریز سود و پانویس حباب را رندر می‌کند
    prepare: async (user) => {
      await user.click(await screen.findByRole('button', { name: 'پاک کردن تاریخ' }));
      await screen.findByRole('list', { name: 'ریز سود' }, { timeout: 10_000 });
    },
  },
  { path: '/settings', heading: 'بیشتر' },
  { path: '/settings/general', heading: 'تنظیمات عمومی' },
  { path: '/settings/coin-types', heading: 'انواع سکه' },
];

/**
 * هر گره‌ی متنی و هر برچسب دسترسی‌پذیری جداگانه سنجیده می‌شود — `textContent` ِ کل صفحه واژه‌های
 * کنار هم را می‌چسباند («ثبت فروش» + «مشتری» = «…فروشمشتری») و «شمش» ِ ساختگی می‌سازد.
 * صفحه‌خوان هم نباید «شمش» بشنود، پس `aria-label`/`title`/`placeholder` هم سنجیده می‌شوند.
 */
function bullionMentions(): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    if (/شمش|bullion/iu.test(text)) found.push(text.trim());
  }
  for (const el of document.querySelectorAll('[aria-label],[title],[placeholder]')) {
    for (const name of ['aria-label', 'title', 'placeholder']) {
      const value = el.getAttribute(name) ?? '';
      if (/شمش|bullion/iu.test(value)) found.push(`${name}=${value}`);
    }
  }
  return found;
}

describe('FE-105 — شمش در UI فاز ۱ وجود ندارد', () => {
  beforeAll(api.start);
  afterAll(api.stop);
  beforeEach(() => {
    api.reset();
    sessionStorage.clear();
    useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} });
    useSaleDraftStore.getState().reset();
    usePurchaseDraftStore.getState().reset();
    useToastStore.setState({ toasts: [] });
    useSessionStore.setState({ session: OWNER });
  });
  afterEach(() => {
    cleanup();
    api.server.resetHandlers();
    useSessionStore.setState({ session: null });
  });

  it.each(PAGES)('$path', async ({ path, heading, prepare }) => {
    renderRoute(path);
    await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 10_000 });
    await prepare?.(userEvent.setup());
    await waitFor(
      () => expect(document.querySelector('[aria-label^="در حال دریافت"]')).toBeNull(),
      {
        timeout: 10_000,
      },
    );
    expect(bullionMentions()).toEqual([]);
  });
});

describe('FE-105 — تعداد سکه همیشه صحیح است', () => {
  function CountHarness() {
    const [count, setCount] = useState(0n);
    return (
      <>
        <CountInput label="تعداد" value={count} onChange={setCount} />
        <NumericKeypad />
      </>
    );
  }

  beforeEach(() =>
    useKeypadStore.setState({ isOpen: false, fields: [], activeId: null, buffers: {} }),
  );
  afterEach(cleanup);

  it('جداکننده‌ی اعشار در فیلد تعداد نادیده گرفته می‌شود: «۱.۵» یعنی ۱۵ سکه، نه ۱٫۵', async () => {
    const user = userEvent.setup();
    render(<CountHarness />);
    const field = screen.getByLabelText('تعداد');
    await user.click(field);
    await user.keyboard('1.5');
    await waitFor(() => expect(field).toHaveAttribute('data-value', '15'));
    // کلید اعشار کیپد برای فیلد تعداد یا نیست یا غیرفعال است
    const separator = screen.queryByRole('button', { name: 'جداکننده اعشار', hidden: true });
    if (separator !== null) expect(separator).toBeDisabled();
  });
});
