import { searchKey } from '@gold/core-calc';
import { DEFAULT_PAGE_SIZE } from '@gold/contracts';
import { HttpResponse, http, delay } from 'msw';
import type { JewelryItemVersion, Party } from '@/api/contracts';
import {
  MAZNEH_RIAL,
  FETCHED_AT,
  MOCK_PROFIT_RATE_BPS,
  MOCK_TAX_RATE_BPS,
  priceJewelryFromVersion,
  balanceSummary,
  COIN_BALANCE_ROWS,
  COIN_TYPE_VERSIONS,
  dashboardFor,
  itemRecords,
  JEWELRY_BALANCE_ROWS,
  jewelryItemVersionRecords,
  partyBalancesFor,
  partyMgById,
  partyRecords,
  partyStatementEntriesFor,
  profitMonth,
  profitToday,
  RECENT_INVENTORY_MOVEMENTS,
  recentTransactions,
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

/**
 * فهرست قابل‌جهش کالای زیورآلات — `POST`/`PATCH` (FE-036) اینجا اضافه
 * یا جایگزین می‌کنند تا `GET` بلافاصله بعد از invalidate تازه را ببیند.
 * هر ردیف همیشه نسخه‌ی **باز** همان کالاست؛ این mock تاریخچه‌ی نسخه‌های
 * قدیمی را نگه نمی‌دارد چون هیچ صفحه‌ای امروز آن را نمی‌خواهد.
 */
let jewelryItemList: JewelryItemVersion[] = [...jewelryItemVersionRecords];
let jewelryItemVersionCounter = jewelryItemVersionRecords.length;

let invoiceCounter = 122;

/**
 * فاکتورهای ثبت‌شده در همین نشست — کلید `invoiceId`.
 *
 * `GET /sales/invoices/:id/versions` (FE-046) باید **همان** چیزی را
 * برگرداند که `POST` ثبت کرده، نه یک fixture ثابت؛ وگرنه رسید چیزی نشان
 * می‌دهد که هیچ‌وقت ثبت نشده و کل قاعده‌ی «رسید = پاسخ سرور» در توسعه
 * ساختگی می‌شود.
 */
const salesInvoiceVersions = new Map<string, unknown>();

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

function partyNotFound() {
  return HttpResponse.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: 'شخص مورد نظر پیدا نشد',
        fields: {},
        requestId: crypto.randomUUID(),
      },
    },
    { status: 404 },
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

  /** `PATCH /api/parties/:id` — قرارداد نهایی BE-024 (`updatePartySchema`/`partySchema`، FE-033). */
  http.patch('/api/parties/:id', async ({ request, params }) => {
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
    if (cached) return HttpResponse.json(cached, { status: 200 });

    const id = params['id'] as string;
    const existing = partyList.find((p) => p.id === id);
    if (!existing) {
      return HttpResponse.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'شخص مورد نظر پیدا نشد',
            fields: {},
            requestId: crypto.randomUUID(),
          },
        },
        { status: 404 },
      );
    }

    const body = (await request.json()) as {
      type?: Party['type'];
      displayName?: string;
      mobile?: string | null;
      nationalId?: string | null;
      notes?: string | null;
    };
    const updated: Party = {
      ...existing,
      ...(body.type !== undefined && { type: body.type }),
      ...(body.displayName !== undefined && { displayName: body.displayName }),
      ...(body.mobile !== undefined && { mobile: body.mobile }),
      ...(body.nationalId !== undefined && { nationalId: body.nationalId }),
      ...(body.notes !== undefined && { notes: body.notes }),
      updatedAt: new Date().toISOString(),
    };
    partyList = partyList.map((p) => (p.id === id ? updated : p));
    idempotencyCache.set(key, updated);
    return HttpResponse.json(updated, { status: 200 });
  }),

  http.get('/api/parties/balance-summary', async () => {
    await delay(READ_DELAY_MS);
    return HttpResponse.json(balanceSummary);
  }),

  /*
   * از این‌جا به بعد handlerهای الگودار `/api/parties/:id...` می‌آیند —
   * عمداً **بعد از** `/api/parties/balance-summary`: MSW به ترتیب تعریف
   * تطبیق می‌دهد، و `:id` روی رشته‌ی «balance-summary» هم به‌عنوان شناسه
   * تطبیق پیدا می‌کند. اگر این ترتیب برعکس شود، آن endpoint شکسته می‌شود.
   */

  /** `GET /parties/:id` — قرارداد نهایی BE-024 (`partySchema`، FE-034). */
  http.get('/api/parties/:id', async ({ params }) => {
    await delay(READ_DELAY_MS);
    const found = partyList.find((p) => p.id === params['id']);
    return found ? HttpResponse.json(found) : partyNotFound();
  }),

  /**
   * `GET /parties/:id/balances` — قرارداد نهایی BE-056 (`partyBalancesSchema`،
   * FE-034). `referenceQuoteId` باید یکی از `maznehQuoteHistory` باشد؛ اگر
   * داده نشده یا پیدا نشده، دقیقاً همان تفاوت رفتار سرور واقعی را می‌دهد
   * (`convertedView: null` در برابر ۴۰۴).
   */
  http.get('/api/parties/:id/balances', async ({ params, request }) => {
    await delay(READ_DELAY_MS);
    const id = params['id'] as string;
    const party = partyList.find((p) => p.id === id);
    if (!party) return partyNotFound();

    const referenceQuoteId = new URL(request.url).searchParams.get('referenceQuoteId');
    if (referenceQuoteId) {
      const quote = maznehQuoteHistory.find((q) => q.id === referenceQuoteId);
      if (!quote) {
        return HttpResponse.json(
          {
            error: {
              code: 'NOT_FOUND',
              message: 'مظنه‌ی مرجع پیدا نشد',
              fields: {},
              requestId: crypto.randomUUID(),
            },
          },
          { status: 404 },
        );
      }
      return HttpResponse.json(
        partyBalancesFor({ id, mg: partyMgById[id] ?? 0 }, quote),
      );
    }

    return HttpResponse.json(partyBalancesFor({ id, mg: partyMgById[id] ?? 0 }, undefined));
  }),

  /**
   * `GET /parties/:id/statement` — قرارداد نهایی BE-057 (`partyStatementSchema`،
   * FE-034). فیلترهای بازه/نوع سند/بُعد اینجا اعمال نمی‌شوند — «آخرین
   * معاملات» فقط `limit` کوچک بدون فیلتر می‌فرستد؛ نسخه‌ی کامل فیلتردار
   * کار FE-070 است.
   */
  http.get('/api/parties/:id/statement', async ({ params, request }) => {
    await delay(READ_DELAY_MS);
    const id = params['id'] as string;
    const party = partyList.find((p) => p.id === id);
    if (!party) return partyNotFound();

    const searchParams = new URL(request.url).searchParams;
    const limit = Number.parseInt(searchParams.get('limit') ?? '50', 10);
    const offset = Number.parseInt(searchParams.get('offset') ?? '0', 10);
    const entries = partyStatementEntriesFor({ id, mg: partyMgById[id] ?? 0 });

    return HttpResponse.json({
      items: entries.slice(offset, offset + limit),
      total: entries.length,
      limit,
      offset,
      partyId: id,
      displayReferenceMazneh: null,
    });
  }),

  /** `POST /parties/:id/deactivate` — قرارداد نهایی BE-024 (`partySchema`، FE-034). */
  http.post('/api/parties/:id/deactivate', async ({ params, request }) => {
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
    if (cached) return HttpResponse.json(cached, { status: 200 });

    const id = params['id'] as string;
    const existing = partyList.find((p) => p.id === id);
    if (!existing) return partyNotFound();

    const updated: Party = { ...existing, status: 'INACTIVE', updatedAt: new Date().toISOString() };
    partyList = partyList.map((p) => (p.id === id ? updated : p));
    idempotencyCache.set(key, updated);
    return HttpResponse.json(updated, { status: 200 });
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

  /**
   * `GET /inventory/jewelry-items` — قرارداد نهایی BE-026
   * (`jewelryItemQuerySchema`/`jewelryItemListSchema`): `search` کد **یا**
   * عنوان را می‌گردد، `active` رشته‌ی `"true"`/`"false"` است (نه boolean
   * خام — دقیقاً همان قرارداد واقعی)، `limit`/`offset` صفحه‌بندی
   * سرور-محور واقعی. بدون فیلتر عیار — قرارداد واقعی چنین چیزی ندارد
   * (`JewelryItemsPage` آن را خودش سمت کلاینت روی یک دسته‌ی بزرگ‌تر انجام
   * می‌دهد، نه اینجا).
   */
  http.get('/api/inventory/jewelry-items', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const params = new URL(request.url).searchParams;
    const search = params.get('search');
    const active = params.get('active');
    const limit = Number.parseInt(params.get('limit') ?? String(DEFAULT_PAGE_SIZE), 10);
    const offset = Number.parseInt(params.get('offset') ?? '0', 10);

    const filtered = jewelryItemList
      .filter((i) => (active === null ? true : i.active === (active === 'true')))
      .filter((i) => matchesQuery(i.title, search) || matchesQuery(i.code, search))
      .sort((a, b) => a.title.localeCompare(b.title, 'fa'));

    return HttpResponse.json({
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    });
  }),

  /**
   * `GET /inventory/jewelry-items/:id` — قرارداد نهایی BE-026
   * (`jewelryItemDetailQuerySchema`/`jewelryItemVersionSchema`). این mock
   * پارامتر اختیاری `at` (نسخه‌ی مؤثر در گذشته) را نادیده می‌گیرد و همیشه
   * نسخه‌ی باز جاری را برمی‌گرداند — تنها مصرف‌کننده‌ی امروز
   * (`SaleLinePricingDialog`، FE-043) هم فقط همین را می‌خواهد. الگوی
   * تطبیق `id` عیناً همان `PATCH` زیر است.
   */
  http.get('/api/inventory/jewelry-items/:id', async ({ params }) => {
    await delay(READ_DELAY_MS);
    const id = params['id'] as string;
    const found = jewelryItemList.find((i) => i.jewelryItemId === id || i.id === id);
    if (!found) {
      return HttpResponse.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'کالا پیدا نشد',
            fields: {},
            requestId: crypto.randomUUID(),
          },
        },
        { status: 404 },
      );
    }
    return HttpResponse.json(found);
  }),

  /** `POST /inventory/jewelry-items` — قرارداد نهایی BE-026 (`createJewelryItemSchema`). */
  http.post('/api/inventory/jewelry-items', async ({ request }) => {
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
      code: string;
      title: string;
      grossWeightMg: string;
      karat: number;
      stoneWeightMg?: string;
      otherDeductionWeightMg?: string;
      wageType: JewelryItemVersion['wageType'];
      wageValue: string;
      validFrom?: string;
    };
    const now = new Date().toISOString();
    jewelryItemVersionCounter += 1;
    const created: JewelryItemVersion = {
      id: `b2000000-0000-4000-8000-${String(jewelryItemVersionCounter).padStart(12, '0')}`,
      jewelryItemId: `b1000000-0000-4000-8000-${String(jewelryItemVersionCounter).padStart(12, '0')}`,
      code: body.code,
      title: body.title,
      grossWeightMg: body.grossWeightMg,
      karat: body.karat,
      stoneWeightMg: body.stoneWeightMg ?? '0',
      otherDeductionWeightMg: body.otherDeductionWeightMg ?? '0',
      wageType: body.wageType,
      wageValue: body.wageValue,
      validFrom: body.validFrom ?? now,
      validTo: null,
      version: 1,
      active: true,
    };
    jewelryItemList = [...jewelryItemList, created];
    idempotencyCache.set(key, created);
    return HttpResponse.json(created, { status: 201 });
  }),

  /**
   * `PATCH /inventory/jewelry-items/:id` — قرارداد نهایی BE-026
   * (`updateJewelryItemSchema`). سرور واقعی اینجا تصمیم می‌گیرد نسخه‌ی
   * تازه بسازد یا فقط عنوان را جا‌به‌جا کند؛ این mock همیشه به‌روزرسانی
   * درجا انجام می‌دهد چون هیچ صفحه‌ای امروز به تاریخچه‌ی نسخه‌ها نیاز ندارد
   * — رفتار قابل‌مشاهده از بیرون (پاسخ PATCH) یکسان می‌ماند.
   */
  http.patch('/api/inventory/jewelry-items/:id', async ({ request, params }) => {
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
    if (cached) return HttpResponse.json(cached, { status: 200 });

    const id = params['id'] as string;
    const existing = jewelryItemList.find((i) => i.jewelryItemId === id || i.id === id);
    if (!existing) {
      return HttpResponse.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'کالا پیدا نشد',
            fields: {},
            requestId: crypto.randomUUID(),
          },
        },
        { status: 404 },
      );
    }

    const body = (await request.json()) as {
      title?: string;
      grossWeightMg?: string;
      karat?: number;
      stoneWeightMg?: string;
      otherDeductionWeightMg?: string;
      wageType?: JewelryItemVersion['wageType'];
      wageValue?: string;
    };
    const updated: JewelryItemVersion = {
      ...existing,
      ...(body.title !== undefined && { title: body.title }),
      ...(body.grossWeightMg !== undefined && { grossWeightMg: body.grossWeightMg }),
      ...(body.karat !== undefined && { karat: body.karat }),
      ...(body.stoneWeightMg !== undefined && { stoneWeightMg: body.stoneWeightMg }),
      ...(body.otherDeductionWeightMg !== undefined && {
        otherDeductionWeightMg: body.otherDeductionWeightMg,
      }),
      ...(body.wageType !== undefined && { wageType: body.wageType }),
      ...(body.wageValue !== undefined && { wageValue: body.wageValue }),
    };
    jewelryItemList = jewelryItemList.map((i) => (i.jewelryItemId === id || i.id === id ? updated : i));
    idempotencyCache.set(key, updated);
    return HttpResponse.json(updated, { status: 200 });
  }),

  /**
   * `GET /inventory/coin-types` — FE-038. ⚠️ بدون معادل بک‌اندی هنوز
   * (توضیح در `api/contracts.ts`) — فقط کاتالوگ ساختگی برمی‌گرداند.
   */
  http.get('/api/inventory/coin-types', async () => {
    await delay(READ_DELAY_MS);
    return HttpResponse.json(COIN_TYPE_VERSIONS);
  }),

  /**
   * `GET /inventory/balances` — قرارداد نهایی BE-028. فقط `itemType=COIN`
   * پیاده‌سازی شده چون فعلاً تنها مصرف‌کننده `CoinInventoryPage` (FE-038)
   * است؛ سایر itemTypeها آرایه‌ی خالی می‌گیرند تا شکل واقعی حفظ شود.
   */
  http.get('/api/inventory/balances', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const itemType = new URL(request.url).searchParams.get('itemType');
    if (itemType === 'COIN') return HttpResponse.json(COIN_BALANCE_ROWS);
    if (itemType === 'JEWELRY') return HttpResponse.json(JEWELRY_BALANCE_ROWS);
    return HttpResponse.json([]);
  }),

  /**
   * `POST /inventory/opening-balances` — قرارداد نهایی BE-028 (FE-039).
   * بدون endpoint اصلاح یا حذف — سند واقعی هم همین‌طور است (بخش ۲-۷
   * CLAUDE.md، دفتر کل append-only)، پس این mock هم چیزی برای «ویرایش»
   * ندارد؛ فقط ثبت و پاسخ.
   */
  http.post('/api/inventory/opening-balances', async ({ request }) => {
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

    const body = (await request.json()) as { effectiveAt: string; description: string };
    const now = new Date().toISOString();
    const created = {
      id: crypto.randomUUID(),
      ledgerTransactionId: crypto.randomUUID(),
      effectiveAt: body.effectiveAt,
      description: body.description,
      createdAt: now,
    };
    idempotencyCache.set(key, created);
    return HttpResponse.json(created, { status: 201 });
  }),

  /** `GET /reporting/dashboard` — قرارداد نهایی BE-062ایش (FE-040). */
  http.get('/api/reporting/dashboard', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const displayUnit = new URL(request.url).searchParams.get('displayUnit') === 'RIAL' ? 'RIAL' : 'GOLD';
    return HttpResponse.json(dashboardFor(displayUnit));
  }),

  /**
   * `GET /inventory/movements/recent` — FE-040. ⚠️ بدون معادل بک‌اندی
   * هنوز (توضیح در `api/contracts.ts`).
   */
  http.get('/api/inventory/movements/recent', async ({ request }) => {
    await delay(READ_DELAY_MS);
    const limit = Number.parseInt(new URL(request.url).searchParams.get('limit') ?? '5', 10);
    return HttpResponse.json(RECENT_INVENTORY_MOVEMENTS.slice(0, limit));
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

  /**
   * `POST /sales/invoices/jewelry` — قرارداد نهایی BE-041
   * (`createJewelryCashSaleSchema`/`jewelryCashSaleSchema`)، FE-045.
   *
   * جایگزین mock منسوخ `POST /api/invoices` شد (آرایه‌ای از خطوط + مظنه‌ی
   * خام) که هیچ‌وقت شکل بک‌اند واقعی را نداشت.
   *
   * مثل سرور واقعی: بدنه فقط ارجاع می‌فرستد (`partyId`, `jewelryItemId`,
   * `quoteId`) و **قیمت اینجا محاسبه می‌شود**، از روی نسخه‌ی کالا و همان
   * مظنه‌ای که `quoteId` نشان می‌دهد — نه از هیچ عددی که کلاینت فرستاده.
   * شماره‌ی فاکتور هم بدون شکاف از یک شمارنده می‌آید.
   */
  http.post('/api/sales/invoices/jewelry', async ({ request }) => {
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
    if (cached) return HttpResponse.json(cached, { status: 201 });

    const body = (await request.json()) as {
      partyId: string;
      jewelryItemId: string;
      quoteId: string;
      effectiveAt: string;
    };

    const version = jewelryItemList.find((item) => item.jewelryItemId === body.jewelryItemId);
    const quote = maznehQuoteHistory.find((q) => q.id === body.quoteId);
    if (!version || !quote) {
      return HttpResponse.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: !version ? 'کالای انتخاب‌شده پیدا نشد' : 'مظنه‌ی انتخاب‌شده پیدا نشد',
            fields: {},
            requestId: crypto.randomUUID(),
          },
        },
        { status: 404 },
      );
    }

    const calc = priceJewelryFromVersion(version, BigInt(quote.amountRial));

    invoiceCounter += 1;
    const result = {
      invoiceId: crypto.randomUUID(),
      // شماره‌ی بدون شکاف — سرور واقعی با جدول شمارنده و SELECT ... FOR UPDATE
      invoiceNumber: invoiceCounter,
      payableRial: calc.payableRial.toString(),
      ledgerTransactionId: crypto.randomUUID(),
      inventoryMovementId: crypto.randomUUID(),
    };

    salesInvoiceVersions.set(result.invoiceId, {
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceNumber,
      versions: [
        {
          version: 1,
          reason: null,
          reasonDetail: null,
          partyId: body.partyId,
          actor: { id: 'c1000000-0000-4000-8000-000000000002', displayName: 'مدیر فروشگاه' },
          createdAt: body.effectiveAt,
          payableRial: calc.payableRial.toString(),
          pureWeightMg: calc.pureWeightMg.toString(),
          karat: version.karat,
          items: [
            {
              itemType: 'JEWELRY',
              itemId: body.jewelryItemId,
              quantity: '1',
              pureWeightMg: calc.pureWeightMg.toString(),
              karat: version.karat,
            },
          ],
          totalsSnapshot: {
            payableRial: calc.payableRial.toString(),
            goldValueRial: calc.goldValueRial.toString(),
            wageRial: calc.wageRial.toString(),
            profitRial: calc.profitRial.toString(),
            taxRial: calc.taxRial.toString(),
            pureWeightMg: calc.pureWeightMg.toString(),
          },
          settingsSnapshot: {
            profitRateBps: MOCK_PROFIT_RATE_BPS.toString(),
            taxRateBps: MOCK_TAX_RATE_BPS.toString(),
          },
          ledgerEffects: [],
          inventoryEffects: [],
        },
      ],
    });

    // فروش یک قطعه‌ی فیزیکی است — همان کالا دیگر در انبار نیست
    jewelryItemList = jewelryItemList.filter((item) => item.jewelryItemId !== body.jewelryItemId);

    idempotencyCache.set(key, result);
    return HttpResponse.json(result, { status: 201 });
  }),

  /**
   * `GET /sales/invoices/:invoiceId/versions` — قرارداد نهایی BE-043
   * (`salesInvoiceVersionHistorySchema`)، FE-046.
   *
   * فقط فاکتورهایی را می‌شناسد که در همین نشست ثبت شده‌اند — دقیقاً همان
   * چیزی که رسید لازم دارد. فهرست فاکتورهای قدیمی کار FE-064/FE-065 است.
   */
  http.get('/api/sales/invoices/:invoiceId/versions', async ({ params }) => {
    await delay(READ_DELAY_MS);

    const found = salesInvoiceVersions.get(String(params.invoiceId));
    if (!found) {
      return HttpResponse.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'فاکتور مورد نظر پیدا نشد',
            fields: {},
            requestId: crypto.randomUUID(),
          },
        },
        { status: 404 },
      );
    }
    return HttpResponse.json(found);
  }),
];

