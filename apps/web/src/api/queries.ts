import { useQuery } from '@tanstack/react-query';
import { apiGet } from './client';
import {
  currentRatesSchema,
  itemListSchema,
  partyBalanceSummarySchema,
  partyListSchema,
  profitReportSchema,
  transactionListSchema,
  type ProfitPeriod,
} from './contracts';

/**
 * هوک‌های داده.
 *
 * صفحات فقط این‌ها را صدا می‌زنند و از وجود MSW بی‌خبرند. جایگزینی
 * پاسخ‌دهنده‌ی ساختگی با سرور واقعی هیچ اثری روی این فایل یا صفحات ندارد.
 */

const MINUTE = 60_000;

export function useCurrentRates() {
  return useQuery({
    queryKey: ['rates', 'current'],
    queryFn: ({ signal }) => apiGet('/rates/current', currentRatesSchema, signal),
    staleTime: MINUTE,
  });
}

export function useBalanceSummary() {
  return useQuery({
    queryKey: ['parties', 'balance-summary'],
    queryFn: ({ signal }) => apiGet('/parties/balance-summary', partyBalanceSummarySchema, signal),
    staleTime: MINUTE,
  });
}

export function useProfitReport(period: ProfitPeriod) {
  return useQuery({
    queryKey: ['reports', 'profit', period],
    queryFn: ({ signal }) => apiGet(`/reports/profit?period=${period}`, profitReportSchema, signal),
    staleTime: MINUTE,
  });
}

export function useRecentTransactions(limit = 5) {
  return useQuery({
    queryKey: ['transactions', 'recent', limit],
    queryFn: ({ signal }) =>
      apiGet(`/transactions/recent?limit=${limit}`, transactionListSchema, signal),
    staleTime: MINUTE,
  });
}

export function usePartySearch(search: string) {
  return useQuery({
    queryKey: ['parties', 'search', search],
    queryFn: ({ signal }) =>
      apiGet(`/parties?search=${encodeURIComponent(search)}`, partyListSchema, signal),
    staleTime: MINUTE,
  });
}

export function useItemSearch(query: string, kind?: string) {
  return useQuery({
    queryKey: ['items', query, kind ?? 'all'],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ q: query });
      if (kind) params.set('kind', kind);
      return apiGet(`/items?${params.toString()}`, itemListSchema, signal);
    },
    staleTime: MINUTE,
  });
}
