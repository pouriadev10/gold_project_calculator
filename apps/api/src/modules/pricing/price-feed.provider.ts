import type { PriceQuoteType } from '../../platform/database/schema';

/** Exact data received from a price-feed adapter; money never crosses this boundary as `number`. */
export interface PriceFeedResult {
  readonly quoteType: PriceQuoteType;
  readonly amountRial: bigint;
  readonly observedAt: Date;
}

/**
 * Boundary for market-rate vendors. Sales and other financial modules depend on
 * neither a particular vendor nor this interface; they consume a resolved quote.
 */
export interface PriceFeedProvider {
  /** `false` فقط برای adapter جای‌خالی؛ صفحه‌ی منبع مظنه (FE-082) آن را «فقط دستی» نشان می‌دهد. */
  readonly configured: boolean;
  fetchLatest(): Promise<PriceFeedResult>;
}

export const PRICE_FEED_PROVIDER = Symbol('PRICE_FEED_PROVIDER');
export const PRICE_FEED_TIMEOUT_MS = Symbol('PRICE_FEED_TIMEOUT_MS');

/** The default adapter proves the fallback path without coupling phase 1 to a vendor. */
export class UnavailablePriceFeedProvider implements PriceFeedProvider {
  readonly configured = false;

  fetchLatest(): Promise<never> {
    return Promise.reject(new Error('هیچ provider مظنه‌ای پیکربندی نشده است'));
  }
}
