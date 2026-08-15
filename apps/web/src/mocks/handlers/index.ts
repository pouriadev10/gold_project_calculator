import { searchKey } from '@gold/core-calc';
import { DEFAULT_PAGE_SIZE } from '@gold/contracts';
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

/**
 * اعتبار آزمایشی FE-026/FE-028 — فقط برای توسعه، هرگز در production
 * استفاده نمی‌شود. دو حساب با نقش متفاوت تا رفتار نقش‌محور (FE-028) هم
 * قابل آزمون دستی باشد، نه فقط با تست خودکار.
 */
const DEMO_PASSWORD = 'password123';
const DEMO_TENANT_SLUG = 'demo';

const DEMO_USERS = {
  'owner@example.com': { id: 'usr-owner-1', displayName: 'مدیر فروشگاه', role: 'OWNER' as const },
  'cashier@example.com': { id: 'usr-cashier-1', displayName: 'صندوق‌دار', role: 'CASHIER' as const },
};

/**
 * توکن‌های تمدید معتبر — شبیه‌سازی چرخش توکن واقعی BE-011 (auth.service.ts).
 * هر تمدید موفق، توکن ورودی را از این مجموعه حذف و توکن تازه را اضافه
 * می‌کند؛ استفاده‌ی دوباره از توکن قدیمی رد می‌شود، همان‌طور که سرور
 * واقعی رد می‌کند. هر توکن به ایمیلی که واردش کرده نگاشت می‌شود تا
 * تمدید هم نقش درست همان کاربر را برگرداند.
 */
const validRefreshTokens = new Map<string, keyof typeof DEMO_USERS>();

function issueSession(key: string, email: keyof typeof DEMO_USERS) {
  const accessToken = `mock-access-${key}`;
  const refreshToken = `mock-refresh-${key}`;
  validRefreshTokens.set(refreshToken, email);
  const demoUser = DEMO_USERS[email];
  return {
    accessToken,
    refreshToken,
    expiresInSeconds: 900,
    user: { id: demoUser.id, email, displayName: demoUser.displayName },
    tenant: { id: 'tnt-demo-1', slug: DEMO_TENANT_SLUG, name: 'زرگری نمونه' },
    role: demoUser.role,
  };
}

function unauthorized(message: string) {
  return HttpResponse.json(
    { error: { code: 'UNAUTHORIZED', message, fields: {}, requestId: crypto.randomUUID() } },
    { status: 401 },
  );
}

export const handlers = [
  http.post('/api/auth/login', async ({ request }) => {
    await delay(WRITE_DELAY_MS);

    const key = request.headers.get('Idempotency-Key');
    if (!key) {
      return HttpResponse.json(
        {
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'هدر Idempotency-Key اجباری است',
            fields: {},
            requestId: crypto.randomUUID(),
          },
        },
        { status: 400 },
      );
    }

    const cached = idempotencyCache.get(key);
    if (cached) return HttpResponse.json(cached);

    const body = (await request.json()) as { email: string; password: string; tenantSlug: string };
    const demoUser = Object.hasOwn(DEMO_USERS, body.email)
      ? (body.email as keyof typeof DEMO_USERS)
      : undefined;

    // پیام دقیقاً همان چیزی است که InvalidCredentialsError (auth.errors.ts) برمی‌گرداند
    if (demoUser === undefined || body.password !== DEMO_PASSWORD || body.tenantSlug !== DEMO_TENANT_SLUG) {
      return unauthorized('ایمیل یا رمز عبور نادرست است');
    }

    const result = issueSession(key, demoUser);
    idempotencyCache.set(key, result);
    return HttpResponse.json(result);
  }),

  http.post('/api/auth/refresh', async ({ request }) => {
    await delay(WRITE_DELAY_MS);

    const key = request.headers.get('Idempotency-Key');
    if (key) {
      const cached = idempotencyCache.get(key);
      if (cached) return HttpResponse.json(cached);
    }

    const body = (await request.json()) as { refreshToken: string };
    const demoUser = validRefreshTokens.get(body.refreshToken);

    // پیام دقیقاً همان چیزی است که InvalidRefreshTokenError برمی‌گرداند
    if (demoUser === undefined) {
      return unauthorized('نشست معتبر نیست یا منقضی شده است');
    }

    // چرخش توکن — توکن قبلی همین الان مصرف‌شده و باطل حساب می‌شود
    validRefreshTokens.delete(body.refreshToken);
    const result = issueSession(key ?? crypto.randomUUID(), demoUser);
    if (key) idempotencyCache.set(key, result);
    return HttpResponse.json(result);
  }),

  http.post('/api/auth/logout', async ({ request }) => {
    await delay(WRITE_DELAY_MS);

    const body = (await request.json()) as { refreshToken: string };
    // موفق حتی برای توکن ناموجود — همان رفتار BE-011 (auth.service.ts)
    validRefreshTokens.delete(body.refreshToken);
    return new HttpResponse(null, { status: 204 });
  }),

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
    // نام پارامتر و پوسته‌ی پاسخ دقیقاً partyListQuerySchema/partyListSchema واقعی‌اند
    const search = new URL(request.url).searchParams.get('search');
    const filtered = partyRecords.filter((p) => matchesQuery(p.displayName, search));
    return HttpResponse.json({
      items: filtered,
      total: filtered.length,
      limit: DEFAULT_PAGE_SIZE,
      offset: 0,
    });
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
    // پارامتر شمارشی است، نه مالی — تجزیه‌ی صحیح کافی است
    const limit = Number.parseInt(new URL(request.url).searchParams.get('limit') ?? '5', 10);
    return HttpResponse.json({ items: recentTransactions.slice(0, limit) });
  }),

  http.post('/api/invoices', async ({ request }) => {
    await delay(WRITE_DELAY_MS);

    const key = request.headers.get('Idempotency-Key');
    if (!key) {
      return HttpResponse.json(
        {
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'هدر Idempotency-Key اجباری است',
            fields: {},
            requestId: crypto.randomUUID(),
          },
        },
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
