import { keepPreviousData, queryOptions, useQueries, useQuery } from '@tanstack/react-query';
import { invoiceAmendmentPreflightSchema, salesInvoiceAmendmentHistorySchema } from '@gold/contracts';
import { apiGet } from './client';
import {
  coinTypeCatalogSchema,
  coinTypeListSchema,
  dashboardSchema,
  inventoryBalanceListSchema,
  jewelryItemListSchema,
  jewelryItemVersionSchema,
  generalSettingsSchema,
  ledgerProfitReportSchema,
  partyBalanceReportSchema,
  partyBalancesSchema,
  partyListSchema,
  partySchema,
  partyStatementSchema,
  priceFeedStatusSchema,
  priceQuoteListSchema,
  priceQuoteSchema,
  recentInventoryMovementListSchema,
  salesInvoiceDetailSchema,
  salesInvoiceListSchema,
  salesInvoiceVersionHistorySchema,
  transactionListSchema,
  type InventoryItemType,
  type JewelryItemQuery,
  type PartyBalancesQuery,
  type PartyListQuery,
  type LedgerProfitReportQuery,
  type PartyBalanceReportQuery,
  type PartyReportDirection,
  type PartyStatementQuery,
  type PriceQuoteType,
  type ReportingDisplayUnit,
  type SalesInvoiceListQuery,
} from './contracts';
import { queryKeys } from './query-keys';

/**
 * هوک‌های داده.
 *
 * صفحات فقط این‌ها را صدا می‌زنند و از وجود MSW بی‌خبرند. جایگزینی
 * پاسخ‌دهنده‌ی ساختگی با سرور واقعی هیچ اثری روی این فایل یا صفحات ندارد.
 */

const MINUTE = 60_000;

/**
 * آخرین مظنه‌ی ثبت‌شده — `GET /pricing/quotes/latest` (BE-021).
 * پاسخ `null` است اگر هیچ مظنه‌ای هنوز برای این مستأجر ثبت نشده — حالت
 * «خالی»، نه خطا. `nullable()` همین را در قرارداد صریح می‌کند.
 */
export function latestPriceQuoteOptions(quoteType: PriceQuoteType = 'MAZNEH') {
  return queryOptions({
    queryKey: queryKeys.pricing.latestQuote(quoteType),
    queryFn: ({ signal }) =>
      apiGet(`/pricing/quotes/latest?quoteType=${quoteType}`, priceQuoteSchema.nullable(), signal),
    staleTime: MINUTE,
  });
}

export function useLatestPriceQuote(quoteType: PriceQuoteType = 'MAZNEH') {
  return useQuery(latestPriceQuoteOptions(quoteType));
}

/**
 * تاریخچه‌ی مظنه — `GET /pricing/quotes` (BE-021، FE-031).
 * تازه‌ترین `MAX_PAGE_SIZE` مظنه را می‌دهد، نه کل تاریخچه (M-13)؛ صفحه‌بندی
 * روی همین آرایه سمت کلاینت در `QuoteHistoryList` انجام می‌شود.
 */
export function usePriceQuoteHistory(quoteType: PriceQuoteType = 'MAZNEH') {
  return useQuery({
    queryKey: queryKeys.pricing.history(quoteType),
    queryFn: ({ signal }) =>
      apiGet(`/pricing/quotes?quoteType=${quoteType}`, priceQuoteListSchema, signal),
    staleTime: MINUTE,
  });
}

/**
 * منبع فعال مظنه و وضعیت فید — `GET /pricing/feed/status` (FE-082). فقط
 * رکوردهای ذخیره‌شده را می‌خواند و هرگز به provider وصل نمی‌شود؛ هر سه نقش.
 */
export function usePriceFeedStatus(quoteType: PriceQuoteType = 'MAZNEH') {
  return useQuery({
    queryKey: queryKeys.pricing.feedStatus(quoteType),
    queryFn: ({ signal }) =>
      apiGet(`/pricing/feed/status?quoteType=${quoteType}`, priceFeedStatusSchema, signal),
    staleTime: MINUTE,
  });
}

/**
 * گزارش سود — `GET /reporting/profit` (BE-060، FE-075).
 *
 * همه‌ی اعداد را سرور از snapshotهای تغییرناپذیر فاکتورها و خریدهای
 * دست‌دوم می‌سازد؛ طلای معادل هر رویداد با مظنه‌ی قفل‌شده‌ی همان رویداد است.
 * `to` در سرور انحصاری است (`lt`). `staleTime: 0` تا پس از یک فروش،
 * بازگشت به این صفحه عدد کهنه نشان ندهد.
 */
function fetchLedgerProfit(query: LedgerProfitReportQuery, signal: AbortSignal) {
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  const qs = params.toString();
  return apiGet(`/reporting/profit${qs ? `?${qs}` : ''}`, ledgerProfitReportSchema, signal);
}

export function useLedgerProfitReport(query: LedgerProfitReportQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.reports.ledgerProfit(query),
    queryFn: ({ signal }) => fetchLedgerProfit(query, signal),
    staleTime: 0,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * روند سود — یک `GET /reporting/profit` برای هر دوره (FE-076). BE-060 سری
 * زمانی ندارد؛ هر عدد همچنان محاسبه‌ی سرور برای همان دوره است. کلید کش
 * همان `useLedgerProfitReport` است، پس دوره‌ای که با بازه‌ی اصلی یکی باشد
 * دوباره گرفته نمی‌شود. `data` فقط وقتی پر است که همه‌ی دوره‌ها رسیده باشند.
 */
export function useLedgerProfitTrend(queries: readonly LedgerProfitReportQuery[]) {
  return useQueries({
    queries: queries.map((query) => ({
      queryKey: queryKeys.reports.ledgerProfit(query),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchLedgerProfit(query, signal),
      staleTime: MINUTE,
    })),
    combine: (results) => {
      const reports = results.flatMap((result) => (result.data === undefined ? [] : [result.data]));
      return {
        data: reports.length === results.length ? reports : undefined,
        isLoading: results.some((result) => result.isLoading),
        isError: results.some((result) => result.isError),
        refetch: () => {
          for (const result of results) if (result.isError) void result.refetch();
        },
      };
    },
  });
}

/**
 * تنظیمات عمومی مستأجر — `GET /settings/general` (FE-080). مقدار مؤثر همین
 * لحظه‌ی هر کلید با شماره‌ی نسخه و شروع اعتبارش؛ هر سه نقش می‌خوانند.
 */
export function useGeneralSettings() {
  return useQuery({
    queryKey: queryKeys.settings.general(),
    queryFn: ({ signal }) => apiGet('/settings/general', generalSettingsSchema, signal),
    staleTime: MINUTE,
  });
}

export function useRecentTransactions(limit = 5) {
  return useQuery({
    queryKey: queryKeys.transactions.recent(limit),
    queryFn: ({ signal }) =>
      apiGet(`/transactions/recent?limit=${limit}`, transactionListSchema, signal),
    staleTime: MINUTE,
  });
}

export function usePartySearch(search: string) {
  return useQuery({
    queryKey: queryKeys.parties.search(search),
    queryFn: ({ signal }) =>
      apiGet(`/parties?search=${encodeURIComponent(search)}`, partyListSchema, signal),
    staleTime: MINUTE,
  });
}

/**
 * فهرست صفحه‌بندی‌شده‌ی اشخاص — `GET /parties` (BE-024، FE-032). برخلاف
 * تاریخچه‌ی مظنه، اینجا صفحه‌بندی **سرور-محور** است (`partyListQuerySchema`
 * واقعاً `limit`/`offset` می‌گیرد)، پس هیچ صفحه‌بندی سمت کلاینتی لازم نیست.
 *
 * `placeholderData: keepPreviousData` صفحه‌ی قبلی را حین رفتن به صفحه‌ی
 * بعد/فیلتر تازه روی صفحه نگه می‌دارد تا هر کلیک یک flash اسکلت نسازد.
 *
 * `enabled` پیش‌فرض `true` است — برای موارد مثل `PartySelector` (FE-035)
 * که تا کاربر چیزی تایپ نکرده اصلاً نباید این fetch برود (به‌جایش فهرست
 * اخیر سمت کلاینت نشان داده می‌شود).
 */
export function useParties(query: PartyListQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.parties.list(query),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        limit: String(query.limit),
        offset: String(query.offset),
      });
      if (query.search) params.set('search', query.search);
      if (query.type) params.set('type', query.type);
      if (query.status) params.set('status', query.status);
      return apiGet(`/parties?${params.toString()}`, partyListSchema, signal);
    },
    staleTime: MINUTE,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** یک شخص — `GET /parties/:id` (BE-024، FE-034). fetch مستقیم با شناسه، نه از فهرست از پیش‌بارگذاری‌شده — چون این صفحه با لینک مستقیم/رفرش هم باید کار کند. */
export function useParty(id: string) {
  return useQuery({
    queryKey: queryKeys.parties.detail(id),
    queryFn: ({ signal }) => apiGet(`/parties/${id}`, partySchema, signal),
    staleTime: MINUTE,
  });
}

/**
 * مانده‌ی چندواحدی شخص — `GET /parties/:id/balances` (BE-056، FE-034).
 *
 * `referenceQuoteId` باید صریح داده شود تا `convertedView` پر شود؛ بدونش
 * سرور `null` برمی‌گرداند (`party-balances.service.ts`) — یعنی معادل
 * طلایی/ریالی محاسبه‌ناپذیر است، نه صفر. صفحه‌ی جزئیات شخص حتی بدون
 * مظنه این query را می‌فرستد تا ماندهٔ خام دفترکل همیشه دیده شود.
 */
export function usePartyBalances(id: string, query: PartyBalancesQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.parties.balances(id, query),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (query.at) params.set('at', query.at);
      if (query.referenceQuoteId) params.set('referenceQuoteId', query.referenceQuoteId);
      const qs = params.toString();
      return apiGet(`/parties/${id}/balances${qs ? `?${qs}` : ''}`, partyBalancesSchema, signal);
    },
    staleTime: MINUTE,
    enabled,
  });
}

/**
 * صورت‌حساب شخص — `GET /parties/:id/statement` (BE-057).
 *
 * دو مصرف‌کننده دارد: «آخرین معاملات» صفحه‌ی جزئیات شخص (FE-034، `limit`
 * کوچک بدون فیلتر) و صفحه‌ی کامل صورت‌حساب با بازه/نوع سند/بُعد (FE-070).
 * صفحه‌ی قبلی حین رفتن به صفحه یا فیلتر بعدی نگه داشته می‌شود تا فهرست
 * چشمک نزند؛ مصرف‌کننده با `isPlaceholderData` حالت «در حال به‌روزرسانی»
 * را نشان می‌دهد.
 */
export function usePartyStatement(id: string, query: PartyStatementQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.parties.statement(id, query),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        limit: String(query.limit),
        offset: String(query.offset),
      });
      if (query.from) params.set('from', query.from);
      if (query.to) params.set('to', query.to);
      if (query.dimensionId) params.set('dimensionId', query.dimensionId);
      if (query.sourceType) params.set('sourceType', query.sourceType);
      if (query.referenceQuoteId) params.set('referenceQuoteId', query.referenceQuoteId);
      return apiGet(`/parties/${id}/statement?${params.toString()}`, partyStatementSchema, signal);
    },
    staleTime: MINUTE,
    // داده‌ی قبلی فقط وقتی جانگه‌دار می‌شود که مال همین شخص باشد؛ رفتن از
    // یک شخص به شخص دیگر نباید لحظه‌ای ردیف‌های نفر قبلی را نشان دهد.
    placeholderData: (previous) => (previous?.partyId === id ? previous : undefined),
    enabled,
  });
}

const REPORT_PATH: Record<PartyReportDirection, string> = {
  DEBTOR: '/reporting/debtors',
  CREDITOR: '/reporting/creditors',
};

/**
 * فهرست بدهکاران/بستانکاران — `GET /reporting/debtors|creditors` (BE-058، FE-072).
 *
 * `referenceQuoteId` الزامی است: سرور ریال و طلا را فقط با یک مظنه‌ی مرجع
 * مقایسه و مرتب می‌کند. ترتیب به اندازه‌ی مانده‌ی قابل‌مقایسه است، نه به
 * واحد نمایش؛ پس صفحه همیشه با یک `displayUnit` ثابت می‌پرسد و کلید واحد
 * فقط نمایش را عوض می‌کند، بدون درخواست تازه.
 */
export function usePartyBalanceReport(
  direction: PartyReportDirection,
  query: PartyBalanceReportQuery,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.parties.balanceReport(direction, query),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        limit: String(query.limit),
        offset: String(query.offset),
        displayUnit: query.displayUnit,
        referenceQuoteId: query.referenceQuoteId,
        sortDirection: query.sortDirection,
      });
      if (query.search) params.set('search', query.search);
      return apiGet(`${REPORT_PATH[direction]}?${params.toString()}`, partyBalanceReportSchema, signal);
    },
    staleTime: MINUTE,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * کاتالوگ نوع سکه — `GET /inventory/coin-types` (FE-038؛ endpoint واقعی FE-081).
 * نسخه‌ی مؤثر همین لحظه‌ی هر نوع، فعال و غیرفعال.
 */
export function useCoinTypes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.coinTypes.all(),
    queryFn: ({ signal }) => apiGet('/inventory/coin-types', coinTypeListSchema, signal),
    staleTime: MINUTE,
    enabled,
  });
}

/**
 * همه‌ی انواع سکه با تاریخچه‌ی کامل نسخه‌ها — `GET /inventory/coin-types/history`
 * (FE-081، صفحه‌ی تنظیمات انواع سکه). هر سه نقش می‌خوانند.
 */
export function useCoinTypeCatalog() {
  return useQuery({
    queryKey: queryKeys.coinTypes.history(),
    queryFn: ({ signal }) => apiGet('/inventory/coin-types/history', coinTypeCatalogSchema, signal),
    staleTime: MINUTE,
  });
}

/** مانده‌ی موجودی به تفکیک نوع کالا — `GET /inventory/balances` (BE-028، FE-038). */
export function useInventoryBalances(itemType: InventoryItemType) {
  return useQuery({
    queryKey: queryKeys.inventoryBalances.byItemType(itemType),
    queryFn: ({ signal }) =>
      apiGet(`/inventory/balances?itemType=${itemType}`, inventoryBalanceListSchema, signal),
    staleTime: MINUTE,
  });
}

/**
 * فهرست کالای زیورآلات — `GET /inventory/jewelry-items` (BE-026، FE-036).
 * هر ردیف نسخه‌ی **باز** (جاری) همان کالاست؛ `partyListQuerySchema`‑وار
 * صفحه‌بندی سرور-محور دارد، پس همان الگوی `useParties` (`keepPreviousData`).
 *
 * قرارداد واقعی هیچ فیلتر عیار ندارد — فقط `search`/`active`. وقتی
 * فیلتر عیار در `JewelryItemsPage` فعال است، آن صفحه عمداً `limit` را
 * به سقف واقعی سرور (`MAX_PAGE_SIZE=200`) می‌برد و خودش عیار را روی
 * نتیجه فیلتر/صفحه‌بندی می‌کند — همان راهی که `QuoteHistoryList` (FE-031)
 * برای نبودِ صفحه‌بندی سرور-محور به کار برد؛ اینجا مسئولیت این hook
 * فقط عبور صادقانه‌ی پارامترهای واقعی است.
 *
 * `enabled` پیش‌فرض `true` است — دقیقاً همان دلیل `useParties` (FE-035):
 * `JewelryItemSelector` (FE-042) تا کاربر چیزی تایپ نکرده اصلاً نباید
 * این fetch برود، به‌جایش فهرست اخیر سمت کلاینت نشان داده می‌شود.
 */
export function useJewelryItems(query: JewelryItemQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.jewelryItems.list(query),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        limit: String(query.limit),
        offset: String(query.offset),
      });
      if (query.search) params.set('search', query.search);
      if (query.active !== undefined) params.set('active', String(query.active));
      return apiGet(`/inventory/jewelry-items?${params.toString()}`, jewelryItemListSchema, signal);
    },
    staleTime: MINUTE,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * جزئیات یک کالای زیورآلات — `GET /inventory/jewelry-items/:id` (BE-026،
 * FE-043). همیشه نسخه‌ی **باز** (جاری) را می‌خواهد — پارامتر اختیاری `at`
 * قرارداد واقعی (`jewelryItemDetailQuerySchema`) اینجا لازم نیست، چون
 * `SaleLinePricingDialog` فقط برای پیش‌پرکردن ویرایشگر با آخرین مشخصات
 * کاتالوگ صدایش می‌زند، نه بازسازی یک لحظه‌ی گذشته.
 */
export function useJewelryItem(id: string | null) {
  return useQuery({
    queryKey: queryKeys.jewelryItems.detail(id ?? ''),
    queryFn: ({ signal }) => apiGet(`/inventory/jewelry-items/${id}`, jewelryItemVersionSchema, signal),
    staleTime: MINUTE,
    enabled: id !== null,
  });
}

/** مشخصات مؤثر کالا در زمان صدور اولیه؛ همان تاریخی که اصلاح روی سرور قیمت‌گذاری می‌شود. */
export function useJewelryItemAt(id: string | null, at: string | null) {
  return useQuery({
    queryKey: queryKeys.jewelryItems.effectiveDetail(id ?? '', at ?? ''),
    queryFn: ({ signal }) =>
      apiGet(
        `/inventory/jewelry-items/${id}?at=${encodeURIComponent(at ?? '')}`,
        jewelryItemVersionSchema,
        signal,
      ),
    staleTime: Infinity,
    enabled: id !== null && at !== null,
  });
}

/**
 * داشبورد موجودی/گزارش‌گیری — `GET /reporting/dashboard` واقعی (FE-040).
 * `displayUnit` فقط نحوه‌ی نمایش کارت‌های مالی سمت سرور را عوض می‌کند
 * (`dashboard.today`/`partyBalances`) — بخش `inventory` (وزن آبشده،
 * تعداد سکه) که این تسک استفاده می‌کند مستقل از این پارامتر همیشه خام
 * است، پس هیچ منطق واحدی سمت کلاینت لازم ندارد.
 */
export function dashboardQueryOptions(displayUnit: ReportingDisplayUnit = 'GOLD') {
  return queryOptions({
    queryKey: queryKeys.dashboard.byUnit(displayUnit),
    queryFn: ({ signal }) =>
      apiGet(`/reporting/dashboard?displayUnit=${displayUnit}`, dashboardSchema, signal),
    staleTime: MINUTE,
  });
}

export function useDashboard(displayUnit: ReportingDisplayUnit = 'GOLD') {
  return useQuery(dashboardQueryOptions(displayUnit));
}

/**
 * نسخه‌های یک فاکتور فروش — `GET /sales/invoices/:id/versions` (BE-043، FE-046).
 *
 * **تنها منبع رسید.** پاسخ ثبت (`POST /sales/invoices/jewelry`) فقط
 * شماره و مبلغ می‌دهد؛ اقلام، زمان و شماره‌ی نسخه از همین‌جا می‌آیند —
 * یعنی رسید چیزی را نشان می‌دهد که واقعاً روی سرور ثبت شده، نه بازسازی
 * محلیِ چیزی که کاربر لحظه‌ای پیش روی صفحه دیده.
 *
 * `staleTime: Infinity` — فاکتور ثبت‌شده append-only است (قاعده‌ی ۲-۷)؛
 * نسخه‌ی موجود هرگز عوض نمی‌شود، فقط ممکن است نسخه‌ی تازه‌ای **اضافه**
 * شود، و آن هم از مسیر اصلاح فاکتور می‌آید که خودش این کلید را باطل
 * می‌کند (FE-067). تازه‌سازی دوره‌ای اینجا فقط ترافیک بی‌فایده است.
 */
export function useInvoiceVersions(invoiceId: string | null) {
  return useQuery({
    queryKey: queryKeys.salesInvoices.versions(invoiceId ?? ''),
    queryFn: ({ signal }) =>
      apiGet(`/sales/invoices/${invoiceId}/versions`, salesInvoiceVersionHistorySchema, signal),
    staleTime: Infinity,
    enabled: invoiceId !== null,
  });
}

/** اختلاف‌های immutable هر اصلاح — همان snapshot تاریخی سرور، نه محاسبه با نرخ امروز. */
export function useInvoiceAmendments(invoiceId: string | null) {
  return useQuery({
    queryKey: queryKeys.salesInvoices.amendments(invoiceId ?? ''),
    queryFn: ({ signal }) =>
      apiGet(`/sales/invoices/${invoiceId}/amendments`, salesInvoiceAmendmentHistorySchema, signal),
    staleTime: Infinity,
    enabled: invoiceId !== null,
  });
}

/** جزئیات immutable فاکتور با نرخ و تنظیمات قفل‌شده — FE-065. */
export function useSalesInvoiceDetail(invoiceId: string | null) {
  return useQuery({
    queryKey: queryKeys.salesInvoices.detail(invoiceId ?? ''),
    queryFn: ({ signal }) =>
      apiGet(`/sales/invoices/${invoiceId}/detail`, salesInvoiceDetailSchema, signal),
    staleTime: Infinity,
    enabled: invoiceId !== null,
  });
}

/** A live, server-owned start decision; submission rechecks with the actual variance. */
export function useInvoiceAmendmentPolicy(invoiceId: string | null) {
  return useQuery({
    queryKey: queryKeys.salesInvoices.amendmentPolicy(invoiceId ?? ''),
    queryFn: ({ signal }) =>
      apiGet(
        `/sales/invoices/${invoiceId}/amendment-policy`,
        invoiceAmendmentPreflightSchema,
        signal,
      ),
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: invoiceId !== null,
  });
}

/**
 * فهرست فاکتورهای فروش — FE-064.
 *
 * صفحه‌بندی و تمام فیلترها سرورمحورند؛ `keepPreviousData` اجازه نمی‌دهد
 * ورق‌زدن یا تغییر فیلتر، فهرست را لحظه‌ای به صفحه‌ی سفید تبدیل کند.
 * سرور: `SalesInvoiceReadsController` (FE-106b)، قرارداد مشترک در
 * `packages/contracts` (`salesInvoiceListSchema`).
 */
export function useSalesInvoices(query: SalesInvoiceListQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.salesInvoices.list(query),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        limit: String(query.limit),
        offset: String(query.offset),
      });
      if (query.invoiceNumber) params.set('invoiceNumber', query.invoiceNumber);
      if (query.partySearch) params.set('partySearch', query.partySearch);
      if (query.status) params.set('status', query.status);
      if (query.from) params.set('from', query.from);
      if (query.to) params.set('to', query.to);
      return apiGet(`/sales/invoices?${params.toString()}`, salesInvoiceListSchema, signal);
    },
    staleTime: MINUTE,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * آخرین حرکات موجودی — FE-040.
 * سرور: `RecentInventoryMovementsController` (FE-106b) — برچسب کالا سمت سرور حل می‌شود.
 */
export function useRecentInventoryMovements(limit = 5) {
  return useQuery({
    queryKey: queryKeys.inventoryMovements.recent(limit),
    queryFn: ({ signal }) =>
      apiGet(`/inventory/movements/recent?limit=${limit}`, recentInventoryMovementListSchema, signal),
    staleTime: MINUTE,
  });
}
