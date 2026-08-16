import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PriceQuote } from '@/api/contracts';

const latestQuoteMock = vi.fn();
vi.mock('@/api/queries', () => ({ useLatestPriceQuote: (...args: unknown[]) => latestQuoteMock(...args) }));

import { useMazneh } from './useMazneh';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function quote(overrides: Partial<PriceQuote> = {}): PriceQuote {
  return {
    id: 'q1',
    quoteType: 'MAZNEH',
    amountRial: 480_000_000n,
    source: 'MANUAL',
    observedAt: new Date().toISOString(),
    createdBy: 'u1',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  latestQuoteMock.mockReset();
});

describe('useMazneh — محاسبه‌ی نرخ گرم (FE-029)', () => {
  it('نرخ گرم ۷۵۰ و ۱۰۰۰ را از مظنه‌ی خام با فرمول core-calc می‌سازد', () => {
    latestQuoteMock.mockReturnValue({
      data: quote({ amountRial: 480_000_000n }),
      isLoading: false,
      isSuccess: true,
      isError: false,
    });

    const { result } = renderHook(() => useMazneh(), { wrapper });

    // نرخ هر گرم عیار k = مظنه × k ÷ ۳۲۴۸.۸۵۱۵ — بخش ۳ CLAUDE.md
    expect(result.current.data?.gram750).toBe(110_808_388n);
    expect(result.current.data?.mazneh).toBe(480_000_000n);
    expect(result.current.data?.gram1000).toBeGreaterThan(result.current.data?.gram750 ?? 0n);
  });

  it('منبع (دستی/فید) بدون تغییر عبور می‌کند', () => {
    latestQuoteMock.mockReturnValue({
      data: quote({ source: 'FEED' }),
      isLoading: false,
      isSuccess: true,
      isError: false,
    });

    const { result } = renderHook(() => useMazneh(), { wrapper });
    expect(result.current.data?.source).toBe('FEED');
  });
});

describe('useMazneh — تازه/قدیمی (FE-029)', () => {
  it('مظنه‌ی همین الان تازه است', () => {
    latestQuoteMock.mockReturnValue({
      data: quote({ observedAt: new Date().toISOString() }),
      isLoading: false,
      isSuccess: true,
      isError: false,
    });

    const { result } = renderHook(() => useMazneh(), { wrapper });
    expect(result.current.data?.isStale).toBe(false);
  });

  it('مظنه‌ی چند روز پیش قدیمی است', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    latestQuoteMock.mockReturnValue({
      data: quote({ observedAt: threeDaysAgo }),
      isLoading: false,
      isSuccess: true,
      isError: false,
    });

    const { result } = renderHook(() => useMazneh(), { wrapper });
    expect(result.current.data?.isStale).toBe(true);
  });
});

describe('useMazneh — بارگذاری، خالی، خطا (FE-029)', () => {
  it('در حال بارگذاری: data تعریف‌نشده است', () => {
    latestQuoteMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isSuccess: false,
      isError: false,
    });

    const { result } = renderHook(() => useMazneh(), { wrapper });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isEmpty).toBe(false);
  });

  it('هیچ مظنه‌ای هنوز ثبت نشده: data=null و isEmpty=true — نه خطا', () => {
    latestQuoteMock.mockReturnValue({
      data: null,
      isLoading: false,
      isSuccess: true,
      isError: false,
    });

    const { result } = renderHook(() => useMazneh(), { wrapper });
    expect(result.current.data).toBeNull();
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.isError).toBe(false);
  });

  it('شکست دریافت: isError=true و isEmpty=false', () => {
    latestQuoteMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isSuccess: false,
      isError: true,
    });

    const { result } = renderHook(() => useMazneh(), { wrapper });
    expect(result.current.isError).toBe(true);
    expect(result.current.isEmpty).toBe(false);
  });
});
