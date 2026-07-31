import { searchKey } from '@gold/core-calc';
import { HttpResponse, http, delay } from 'msw';
import {
  MAZNEH_RIAL,
  FETCHED_AT,
  articlePriceRial,
  balanceSummary,
  coins,
  gramRates,
  itemRecords,
  partyRecords,
  profitMonth,
  profitToday,
  recentTransactions,
  rialToWire,
} from './fixtures';

/**
 * پاسخ‌دهنده‌های ساختگی.
 *
 * این‌ها **قرارداد نهایی REST** را پیاده می‌کنند، نه یک میان‌بر موقت.
 * وقتی بک‌اند آمد، فقط `worker.start()` در `main.tsx` خاموش می‌شود و
 * هیچ خطی از کد صفحات عوض نمی‌شود.
 *
 * تأخیر عمدی ۲۵۰ms روی خواندن‌ها: بدون آن، حالت `loading` هیچ‌وقت دیده
 * نمی‌شود و Skeletonها عملاً تست نمی‌شوند. شبکه‌ی پاساژ بازار قطعاً
 * کندتر از این است.
 */

const READ_DELAY_MS = 250;
const WRITE_DELAY_MS = 400;

/** جست‌وجوی فارسی‌آگاه — «علي» باید «علی» را پیدا کند */
function matchesQuery(haystack: string, query: string | null): boolean {
  if (!query) return true;
  return searchKey(haystack).includes(searchKey(query));
}

let invoiceCounter = 122;

/** حافظه‌ی کلیدهای idempotency — تکرار همان کلید همان پاسخ را می‌دهد */
const idempotencyCache = new Map<string, unknown>();

export const handlers = [
  http.get('/api/rates/current', async () => {
    await delay(READ_DELAY_MS);
    return HttpResponse.json({
      maznehRial: MAZNEH_RIAL.toString(),
      fetchedAt: FETCHED_AT.toISOString(),
      gramRates,
      coins,
    });
  }),

  http.get('/api/parties', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const query = new URL(request.url).searchParams.get('q');
    const filtered = partyRecords.filter((p) => matchesQuery(p.name, query));
    return HttpResponse.json({ items: filtered, total: filtered.length });
  }),

  http.get('/api/parties/balance-summary', async () => {
    await delay(READ_DELAY_MS);
    return HttpResponse.json(balanceSummary);
  }),

  http.get('/api/items', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const url = new URL(request.url);
    const query = url.searchParams.get('q');
    const kind = url.searchParams.get('kind');

    const filtered = itemRecords.filter(
      (i) => (matchesQuery(i.name, query) || matchesQuery(i.code, query)) && (!kind || i.kind === kind),
    );
    return HttpResponse.json({ items: filtered, total: filtered.length });
  }),

  http.get('/api/reports/profit', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const period = new URL(request.url).searchParams.get('period');
    return HttpResponse.json(period === 'today' ? profitToday : profitMonth);
  }),

  http.get('/api/transactions/recent', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? '5');
    return HttpResponse.json({ items: recentTransactions.slice(0, limit) });
  }),

  http.post('/api/invoices', async ({ request }) => {
    await delay(WRITE_DELAY_MS);

    const key = request.headers.get('Idempotency-Key');
    if (!key) {
      return HttpResponse.json(
        { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'هدر Idempotency-Key اجباری است' },
        { status: 400 },
      );
    }

    // همان کلید = همان عملیات. فاکتور دوم ساخته نمی‌شود.
    const cached = idempotencyCache.get(key);
    if (cached) return HttpResponse.json(cached);

    const body = (await request.json()) as {
      lines: { grossMg: string | null; karat: number | null; wageRial: string; count: number | null }[];
    };

    let totalRial = 0n;
    for (const line of body.lines) {
      const wage = BigInt(line.wageRial);
      if (line.grossMg && line.karat) {
        totalRial += articlePriceRial(BigInt(line.grossMg), line.karat, wage);
      } else {
        totalRial += wage;
      }
    }

    invoiceCounter += 1;
    const result = {
      id: `INV-${invoiceCounter}`,
      // شماره‌ی بدون شکاف — سرور واقعی با جدول شمارنده و SELECT ... FOR UPDATE
      number: `1405-${String(invoiceCounter).padStart(6, '0')}`,
      total: rialToWire(totalRial),
      createdAt: new Date().toISOString(),
    };

    idempotencyCache.set(key, result);
    return HttpResponse.json(result, { status: 201 });
  }),
];
