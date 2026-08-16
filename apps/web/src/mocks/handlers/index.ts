import { searchKey } from '@gold/core-calc';
import { DEFAULT_PAGE_SIZE } from '@gold/contracts';
import { HttpResponse, http, delay } from 'msw';
import type { Party } from '@/api/contracts';
import {
  MAZNEH_RIAL,
  FETCHED_AT,
  articlePriceRial,
  balanceSummary,
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

/** آینه‌ی `MOBILE_SEPARATOR` واقعی (`parties.service.ts`، BE-024) — «۰۹۱۲-۱۲۳» باید «09121234567» را پیدا کند */
const MOBILE_SEPARATOR = /[\s\-()[\]{}./\\]/gu;

function matchesMobile(mobile: string | null, query: string | null): boolean {
  if (!query) return true;
  if (!mobile) return false;
  return searchKey(mobile).replace(MOBILE_SEPARATOR, '').includes(searchKey(query).replace(MOBILE_SEPARATOR, ''));
}

/**
 * فهرست قابل‌جهش اشخاص — `POST /parties` (FE-032) رکورد تازه را اینجا
 * اضافه می‌کند تا `GET /parties` بلافاصله بعد از invalidate آن را ببیند،
 * همان الگوی `maznehQuoteHistory` برای مظنه.
 */
let partyList: Party[] = [...partyRecords];

let invoiceCounter = 122;

/** حافظه‌ی کلیدهای idempotency — تکرار همان کلید همان پاسخ را می‌دهد */
const idempotencyCache = new Map<string, unknown>();

/**
 * تاریخچه‌ی مظنه‌ی MAZNEH — نزولی بر اساس `observedAt` (همان ترتیب
 * `list()` واقعی، `price-quotes.service.ts`). عنصر ۰ = «جاری».
 *
 * قابل جهش با `POST /pricing/quotes/manual` (FE-030): هر ثبت موفق در
 * ابتدای همین آرایه اضافه می‌شود تا invalidation واقعی قابل‌مشاهده باشد —
 * هم `GET .../latest` هم `GET .../quotes` (فهرست، FE-031) مقدار تازه را
 * فوراً ببینند، نه همیشه fixture اولیه را.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
let maznehQuoteHistory = [
  {
    // priceQuoteSchema واقعی id/createdBy را با uuidSchema اعتبارسنجی می‌کند — رشته‌ی دلخواه رد می‌شود
    id: 'c1000000-0000-4000-8000-000000000001',
    quoteType: 'MAZNEH' as const,
    amountRial: MAZNEH_RIAL.toString(),
    source: 'MANUAL' as const,
    observedAt: FETCHED_AT.toISOString(),
    createdBy: 'c1000000-0000-4000-8000-000000000002',
    createdAt: FETCHED_AT.toISOString(),
  },
  {
    id: 'c1000000-0000-4000-8000-000000000003',
    quoteType: 'MAZNEH' as const,
    amountRial: (MAZNEH_RIAL - 3_500_000n).toString(),
    source: 'FEED' as const,
    observedAt: new Date(FETCHED_AT.getTime() - 2 * DAY_MS).toISOString(),
    createdBy: null,
    createdAt: new Date(FETCHED_AT.getTime() - 2 * DAY_MS).toISOString(),
  },
  {
    id: 'c1000000-0000-4000-8000-000000000004',
    quoteType: 'MAZNEH' as const,
    amountRial: (MAZNEH_RIAL - 9_000_000n).toString(),
    source: 'MANUAL' as const,
    observedAt: new Date(FETCHED_AT.getTime() - 6 * DAY_MS).toISOString(),
    createdBy: 'c1000000-0000-4000-8000-000000000002',
    createdAt: new Date(FETCHED_AT.getTime() - 6 * DAY_MS).toISOString(),
  },
  {
    id: 'c1000000-0000-4000-8000-000000000005',
    quoteType: 'MAZNEH' as const,
    amountRial: (MAZNEH_RIAL - 14_000_000n).toString(),
    source: 'FEED' as const,
    observedAt: new Date(FETCHED_AT.getTime() - 13 * DAY_MS).toISOString(),
    createdBy: null,
    createdAt: new Date(FETCHED_AT.getTime() - 13 * DAY_MS).toISOString(),
  },
];

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

  /**
   * `GET /pricing/quotes/latest` — قرارداد نهایی BE-021، دقیقاً همان
   * `priceQuoteSchema` واقعی. `FETCHED_AT` عمداً قدیمی مانده (بخش بالای
   * fixtures.ts) تا حالت «قدیمی» ویجت مظنه بدون کار اضافه قابل‌آزمون بماند.
   */
  http.get('/api/pricing/quotes/latest', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const quoteType = new URL(request.url).searchParams.get('quoteType');
    if (quoteType !== 'MAZNEH') return HttpResponse.json(null);

    return HttpResponse.json(maznehQuoteHistory[0] ?? null);
  }),

  /**
   * `GET /pricing/quotes` — قرارداد نهایی BE-021 (`priceQuoteQuerySchema`):
   * فقط `quoteType` اختیاری، بدون صفحه‌بندی سرور-محور — همان چیزی که
   * `list()` واقعی می‌دهد. صفحه‌بندی سمت کلاینت در `QuoteHistoryList`
   * (FE-031) روی همین آرایه‌ی کامل انجام می‌شود.
   */
  http.get('/api/pricing/quotes', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const quoteType = new URL(request.url).searchParams.get('quoteType');
    const filtered =
      quoteType === null ? maznehQuoteHistory : maznehQuoteHistory.filter((q) => q.quoteType === quoteType);

    return HttpResponse.json(filtered);
  }),

  /**
   * `POST /pricing/quotes/manual` — قرارداد نهایی BE-021
   * (`createManualPriceQuoteSchema`): فقط `quoteType` و `amountRial`.
   * بدون `observedAt` یا `description` ورودی — سرور واقعی هم `observedAt`
   * را خودش می‌سازد (`price-quotes.service.ts`) و ستون توضیحی اصلاً وجود
   * ندارد؛ FE-030 هم به همین شکل فقط مبلغ را می‌گیرد.
   */
  http.post('/api/pricing/quotes/manual', async ({ request }) => {
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
    if (cached) return HttpResponse.json(cached, { status: 201 });

    const body = (await request.json()) as { quoteType: 'MAZNEH'; amountRial: string };
    const now = new Date().toISOString();
    const created = {
      id: crypto.randomUUID(),
      quoteType: body.quoteType,
      amountRial: body.amountRial,
      source: 'MANUAL' as const,
      observedAt: now,
      createdBy: 'c1000000-0000-4000-8000-000000000002',
      createdAt: now,
    };
    // تازه‌ترین اول — همان ترتیب `orderBy(desc(observedAt), ...)` واقعی
    maznehQuoteHistory = [created, ...maznehQuoteHistory];
    idempotencyCache.set(key, created);
    return HttpResponse.json(created, { status: 201 });
  }),

  /**
   * `GET /parties` — قرارداد نهایی BE-024 (`partyListQuerySchema`/`partyListSchema`):
   * `search` نام **یا** موبایل را می‌گردد، `type`/`status` فیلتر می‌کنند،
   * `limit`/`offset` صفحه‌بندی سرور-محور واقعی است (نه سمت کلاینت مثل
   * تاریخچه‌ی مظنه) — همان ترتیب `list()` واقعی: نام صعودی.
   */
  http.get('/api/parties', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const params = new URL(request.url).searchParams;
    const search = params.get('search');
    const type = params.get('type');
    const status = params.get('status');
    const limit = Number.parseInt(params.get('limit') ?? String(DEFAULT_PAGE_SIZE), 10);
    const offset = Number.parseInt(params.get('offset') ?? '0', 10);

    const filtered = partyList
      .filter((p) => (type ? p.type === type : true))
      .filter((p) => (status ? p.status === status : true))
      .filter((p) => matchesQuery(p.displayName, search) || matchesMobile(p.mobile, search))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fa'));

    return HttpResponse.json({
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    });
  }),

  /** `POST /parties` — قرارداد نهایی BE-024 (`createPartySchema`/`partySchema`). */
  http.post('/api/parties', async ({ request }) => {
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
    if (cached) return HttpResponse.json(cached, { status: 201 });

    const body = (await request.json()) as {
      type: Party['type'];
      displayName: string;
      mobile?: string;
      nationalId?: string;
      notes?: string;
    };
    const now = new Date().toISOString();
    const created: Party = {
      id: crypto.randomUUID(),
      type: body.type,
      displayName: body.displayName,
      mobile: body.mobile ?? null,
      nationalId: body.nationalId ?? null,
      linkedTenantId: null,
      status: 'ACTIVE',
      notes: body.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    partyList = [...partyList, created];
    idempotencyCache.set(key, created);
    return HttpResponse.json(created, { status: 201 });
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
