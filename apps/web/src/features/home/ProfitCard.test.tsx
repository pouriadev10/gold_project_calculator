import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ledgerProfitReportSchema, type SessionResponse } from '@/api/contracts';
import { useSessionStore } from '@/stores/session-store';
import { useUnitStore } from '@/stores/unit-store';
import { createIntegrationServer, renderRoute } from '@/test/integration';

/**
 * کارت سود خانه — FE-106a. روی `GET /reporting/profit` ِ واقعی (BE-060)، نه `/reports/profit` ِ
 * فقط‌MSW ِ قبلی: بازه‌ها مرز روز مستأجرند و هر مبلغ هر دو چهره را از پاسخ سرور می‌گیرد.
 */

const api = createIntegrationServer();
const OWNER: SessionResponse = {
  accessToken: 'fe106-access',
  refreshToken: 'fe106-refresh',
  expiresInSeconds: 900,
  user: { id: 'c1000000-0000-4000-8000-000000000002', email: 'owner@example.com', displayName: 'مالک نمونه' },
  tenant: { id: 't1', slug: 'demo', name: 'زرگری نمونه', timezone: 'Asia/Tehran' },
  role: 'OWNER',
};

const measure = (rial: string, goldEquivalentMg: string) => ({ rial, goldEquivalentMg });
const REPORT = ledgerProfitReportSchema.parse({
  from: null,
  to: null,
  revenue: measure('900000000', '6000'),
  costOfGoods: measure('700000000', '4700'),
  grossProfit: measure('200000000', '1300'),
  coinBubbleEffect: measure('30000000', '200'),
  operatingProfit: measure('170000000', '1100'),
  goldPriceEffect: measure('-12000000', '-80'),
  totalProfit: measure('188000000', '1220'),
});

beforeAll(api.start);
afterAll(api.stop);
beforeEach(() => {
  api.reset();
  api.server.use(http.get('/api/reporting/profit', () => HttpResponse.json(REPORT)));
  useSessionStore.setState({ session: OWNER });
  useUnitStore.setState({ unit: 'rial' });
});
afterEach(() => {
  cleanup();
  api.server.resetHandlers();
  useSessionStore.setState({ session: null });
});

async function profitCard(): Promise<HTMLElement> {
  const radios = await screen.findByRole('radiogroup', { name: 'بازه‌ی زمانی سود' }, { timeout: 10_000 });
  return radios.closest('div.rounded-xl, [class*="rounded"]')!.parentElement!.closest('div')!;
}

function profitRequests() {
  return api.requests().filter((request) => request.method === 'GET' && request.path === '/api/reporting/profit');
}

describe('ProfitCard — FE-106a', () => {
  it('سود کل و ریز را از پاسخ واقعی `/reporting/profit` نشان می‌دهد و از کلید واحد پیروی می‌کند', async () => {
    const user = userEvent.setup();
    renderRoute('/dashboard');
    await profitCard();
    expect(api.requests().some((request) => request.path === '/api/reports/profit')).toBe(false);

    const amounts = () => [...document.querySelectorAll('[data-raw]')].map((el) => el.getAttribute('data-raw'));
    await waitFor(() => expect(amounts()).toEqual(expect.arrayContaining(['188000000', '170000000', '-12000000', '30000000'])));
    await user.click(within(screen.getAllByRole('radiogroup', { name: 'واحد نمایش اعداد' })[0]!).getByRole('radio', { name: /طلا/ }));
    await waitFor(() => expect(amounts()).toEqual(expect.arrayContaining(['1220', '1100', '-80', '200'])));
    expect(screen.getByRole('link', { name: /گزارش کامل سود/ })).toHaveAttribute('href', '/reporting/profit');
  });

  it('«این ماه» و «امروز» بازه‌ی نیمه‌باز به مرز روز مستأجر می‌فرستند', async () => {
    const user = userEvent.setup();
    renderRoute('/dashboard');
    const radios = await screen.findByRole('radiogroup', { name: 'بازه‌ی زمانی سود' }, { timeout: 10_000 });
    await waitFor(() => expect(profitRequests().length).toBeGreaterThan(0));
    const month = new URLSearchParams(profitRequests().at(-1)!.query);

    await user.click(within(radios).getByRole('radio', { name: 'امروز' }));
    await waitFor(() => expect(profitRequests().some((r) => r.query !== profitRequests()[0]!.query)).toBe(true));
    const today = new URLSearchParams(profitRequests().at(-1)!.query);

    const span = (params: URLSearchParams) => Date.parse(params.get('to')!) - Date.parse(params.get('from')!);
    // روز تهران: نیمه‌شب ‎+03:30 تا نیمه‌شب بعد
    expect(span(today)).toBe(24 * 60 * 60 * 1000);
    expect(today.get('from')).toMatch(/T20:30:00\.000Z$/u);
    expect(span(month)).toBeGreaterThanOrEqual(29 * 24 * 60 * 60 * 1000);
  });
});
