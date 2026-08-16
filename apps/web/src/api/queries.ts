import { useQuery } from '@tanstack/react-query';
import { apiGet } from './client';
import {
  itemListSchema,
  partyBalanceSummarySchema,
  partyListSchema,
  priceQuoteListSchema,
  priceQuoteSchema,
  profitReportSchema,
  transactionListSchema,
  type PriceQuoteType,
  type ProfitPeriod,
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
