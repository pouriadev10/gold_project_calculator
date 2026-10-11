import { describe, expect, it } from 'vitest';
import { priceFeedRefreshResultSchema, refreshPriceFeedSchema } from '../src/pricing/price-feed.js';

const quote = {
  id: 'a4555172-3398-4a25-8fe6-b058650e5e9c',
  quoteType: 'MAZNEH',
  amountRial: '412000000',
  source: 'MANUAL',
  observedAt: '2026-10-11T08:00:00.000Z',
  createdBy: null,
  createdAt: '2026-10-11T08:00:00.000Z',
} as const;

describe('price feed contract — FE-082', () => {
  it('a fallback always carries the stored quote it fell back to and the reason', () => {
    expect(priceFeedRefreshResultSchema.safeParse({ outcome: 'FALLBACK', failure: 'PROVIDER_TIMEOUT', quote }).success).toBe(true);
    expect(priceFeedRefreshResultSchema.safeParse({ outcome: 'FALLBACK', failure: null, quote }).success).toBe(false);
    expect(priceFeedRefreshResultSchema.safeParse({ outcome: 'FALLBACK', failure: 'PROVIDER_ERROR', quote: null }).success).toBe(false);
  });

  it('only a feed success has no failure, and only UNAVAILABLE has no quote', () => {
    expect(priceFeedRefreshResultSchema.safeParse({ outcome: 'FEED', failure: null, quote: { ...quote, source: 'FEED' } }).success).toBe(true);
    expect(priceFeedRefreshResultSchema.safeParse({ outcome: 'FEED', failure: 'PROVIDER_ERROR', quote }).success).toBe(false);
    expect(priceFeedRefreshResultSchema.safeParse({ outcome: 'UNAVAILABLE', failure: 'NOT_CONFIGURED', quote: null }).success).toBe(true);
  });

  it('the refresh input names a quote type and nothing else — the client never supplies an amount', () => {
    expect(refreshPriceFeedSchema.safeParse({ quoteType: 'MAZNEH' }).success).toBe(true);
    expect(refreshPriceFeedSchema.safeParse({ quoteType: 'MAZNEH', amountRial: '1' }).success).toBe(false);
  });
});
