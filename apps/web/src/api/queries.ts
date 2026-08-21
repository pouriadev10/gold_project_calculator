import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiGet } from './client';
import {
  coinTypeListSchema,
  dashboardSchema,
  inventoryBalanceListSchema,
  itemListSchema,
  jewelryItemListSchema,
  jewelryItemVersionSchema,
  partyBalanceSummarySchema,
  partyBalancesSchema,
  partyListSchema,
  partySchema,
  partyStatementSchema,
  priceQuoteListSchema,
  priceQuoteSchema,
  profitReportSchema,
  recentInventoryMovementListSchema,
  transactionListSchema,
  type InventoryItemType,
  type JewelryItemQuery,
  type PartyBalancesQuery,
  type PartyListQuery,
  type PartyStatementQuery,
  type PriceQuoteType,
  type ProfitPeriod,
  type ReportingDisplayUnit,
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
export function useLatestPriceQuote(quoteType: PriceQuoteType = 'MAZNEH') {
  return useQuery({
    queryKey: queryKeys.pricing.latestQuote(quoteType),
    queryFn: ({ signal }) =>
      apiGet(`/pricing/quotes/latest?quoteType=${quoteType}`, priceQuoteSchema.nullable(), signal),
    staleTime: MINUTE,
  });
}

/**
 * تاریخچه‌ی مظنه — `GET /pricing/quotes` (BE-021، FE-031).
 * کل فهرست tenant را می‌دهد (بدون صفحه‌بندی سمت سرور)؛ صفحه‌بندی روی
 * همین آرایه سمت کلاینت در `QuoteHistoryList` انجام می‌شود.
 */
export function usePriceQuoteHistory(quoteType: PriceQuoteType = 'MAZNEH') {
  return useQuery({
    queryKey: queryKeys.pricing.history(quoteType),
    queryFn: ({ signal }) =>
      apiGet(`/pricing/quotes?quoteType=${quoteType}`, priceQuoteListSchema, signal),
    staleTime: MINUTE,
  });
}

export function useBalanceSummary() {
  return useQuery({
    queryKey: queryKeys.parties.balanceSummary(),
    queryFn: ({ signal }) => apiGet('/parties/balance-summary', partyBalanceSummarySchema, signal),
    staleTime: MINUTE,
  });
}

export function useProfitReport(period: ProfitPeriod) {
  return useQuery({
    queryKey: queryKeys.reports.profit(period),
    queryFn: ({ signal }) => apiGet(`/reports/profit?period=${period}`, profitReportSchema, signal),
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
 * طلایی/ریالی محاسبه‌ناپذیر است، نه صفر. صفحه‌ی جزئیات شخص همیشه با
 * `referenceQuoteId` آخرین مظنه فراخوانی می‌کند و اگر مظنه‌ای هنوز ثبت
 * نشده، `enabled: false` این query را اصلاً نمی‌فرستد.
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
 * صورت‌حساب شخص — `GET /parties/:id/statement` (BE-057، FE-034).
 *
 * اینجا فقط برای «آخرین معاملات» (`limit` کوچک، بدون فیلتر) استفاده
 * می‌شود؛ صفحه‌ی کامل صورت‌حساب با بازه‌ی تاریخ/فیلتر نوع سند/بُعد کار
 * FE-070 است.
 */
export function usePartyStatement(id: string, query: PartyStatementQuery) {
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
  });
}

export function useItemSearch(query: string, kind?: string) {
  return useQuery({
    queryKey: queryKeys.items.search(query, kind ?? 'all'),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ q: query });
      if (kind) params.set('kind', kind);
      return apiGet(`/items?${params.toString()}`, itemListSchema, signal);
    },
    staleTime: MINUTE,
  });
}

/**
 * کاتالوگ نوع سکه — `GET /inventory/coin-types` (FE-038).
 * ⚠️ بدون معادل بک‌اندی هنوز — فقط MSW پاسخ می‌دهد (توضیح در `api/contracts.ts`).
 */
export function useCoinTypes() {
  return useQuery({
    queryKey: queryKeys.coinTypes.all(),
    queryFn: ({ signal }) => apiGet('/inventory/coin-types', coinTypeListSchema, signal),
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

/**
 * داشبورد موجودی/گزارش‌گیری — `GET /reporting/dashboard` واقعی (FE-040).
 * `displayUnit` فقط نحوه‌ی نمایش کارت‌های مالی سمت سرور را عوض می‌کند
 * (`dashboard.today`/`partyBalances`) — بخش `inventory` (وزن آبشده،
 * تعداد سکه) که این تسک استفاده می‌کند مستقل از این پارامتر همیشه خام
 * است، پس هیچ منطق واحدی سمت کلاینت لازم ندارد.
 */
export function useDashboard(displayUnit: ReportingDisplayUnit = 'GOLD') {
  return useQuery({
    queryKey: queryKeys.dashboard.byUnit(displayUnit),
    queryFn: ({ signal }) =>
      apiGet(`/reporting/dashboard?displayUnit=${displayUnit}`, dashboardSchema, signal),
    staleTime: MINUTE,
  });
}

/**
 * آخرین حرکات موجودی — FE-040.
 * ⚠️ بدون معادل بک‌اندی هنوز — فقط MSW پاسخ می‌دهد (توضیح در `api/contracts.ts`).
 */
export function useRecentInventoryMovements(limit = 5) {
  return useQuery({
    queryKey: queryKeys.inventoryMovements.recent(limit),
    queryFn: ({ signal }) =>
      apiGet(`/inventory/movements/recent?limit=${limit}`, recentInventoryMovementListSchema, signal),
    staleTime: MINUTE,
  });
}
