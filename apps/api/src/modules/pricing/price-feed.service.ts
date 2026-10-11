import { Inject, Injectable } from '@nestjs/common';
import { priceQuoteAmountRialSchema, priceQuoteTypeSchema } from '@gold/contracts';
import {
  InvalidPriceFeedResultError,
  PriceFeedTimeoutError,
  PriceQuoteUnavailableError,
} from './price-feed.errors';
import { PRICE_FEED_PROVIDER, PRICE_FEED_TIMEOUT_MS } from './price-feed.provider';
import { PriceQuotesService } from './price-quotes.service';
import type { PriceQuote, PriceQuoteSource, PriceQuoteType } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';
import type { PriceFeedProvider, PriceFeedResult } from './price-feed.provider';

export interface ResolveLatestPriceQuoteInput {
  readonly tenantId: string;
  readonly quoteType: PriceQuoteType;
  /** User choice is explicit: MANUAL never silently switches to a feed. */
  readonly selectedSource: PriceQuoteSource;
}

export type PriceQuoteResolution =
  | {
      readonly quote: PriceQuote;
      readonly selectedSource: 'MANUAL';
      readonly outcome: 'MANUAL';
    }
  | {
      readonly quote: PriceQuote;
      readonly selectedSource: 'FEED';
      readonly outcome: 'FEED';
    }
  | {
      readonly quote: PriceQuote;
      readonly selectedSource: 'FEED';
      readonly outcome: 'FALLBACK';
      readonly failure: 'PROVIDER_ERROR' | 'PROVIDER_TIMEOUT';
    };

export type PriceFeedFailureReason = 'NOT_CONFIGURED' | 'PROVIDER_ERROR' | 'PROVIDER_TIMEOUT';

/** نتیجه‌ی تماس با provider، پیش از هر نوشتنی در دیتابیس. */
export type PriceFeedAttempt =
  | { readonly ok: true; readonly result: PriceFeedResult }
  | { readonly ok: false; readonly failure: PriceFeedFailureReason };

/** نتیجه‌ی «دریافت از فید» دستی صفحه‌ی منبع مظنه (FE-082). */
export type PriceFeedRefreshOutcome =
  | { readonly outcome: 'FEED'; readonly failure: null; readonly quote: PriceQuote }
  | { readonly outcome: 'FALLBACK'; readonly failure: PriceFeedFailureReason; readonly quote: PriceQuote }
  | { readonly outcome: 'UNAVAILABLE'; readonly failure: PriceFeedFailureReason; readonly quote: null };

export interface PriceFeedStatusRecord {
  readonly providerConfigured: boolean;
  readonly activeQuote: PriceQuote | undefined;
  readonly latestFeedQuote: PriceQuote | undefined;
  readonly latestManualQuote: PriceQuote | undefined;
}

function isValidFeedResult(value: PriceFeedResult): boolean {
  return (
    priceQuoteTypeSchema.safeParse(value.quoteType).success &&
    typeof value.amountRial === 'bigint' &&
    priceQuoteAmountRialSchema.safeParse(value.amountRial.toString()).success &&
    value.observedAt instanceof Date &&
    !Number.isNaN(value.observedAt.getTime())
  );
}

/** Adds a bounded wait around an untrusted provider without cancelling the application request. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new PriceFeedTimeoutError()), timeoutMs);
  });

  try {
    return await Promise.race([promise, expiry]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

/**
 * Resolves a quote for a caller that has already explicitly chosen its source.
 * Feed failures degrade to the last stored quote, so an unavailable vendor does
 * not block financial work. A manual choice, conversely, is never overridden.
 */
@Injectable()
export class PriceFeedService {
  constructor(
    @Inject(PriceQuotesService) private readonly quotes: PriceQuotesService,
    @Inject(PRICE_FEED_PROVIDER) private readonly provider: PriceFeedProvider,
    @Inject(PRICE_FEED_TIMEOUT_MS) private readonly timeoutMs: number,
  ) {}

  async resolveLatest(input: ResolveLatestPriceQuoteInput): Promise<PriceQuoteResolution> {
    if (input.selectedSource === 'MANUAL') {
      const quote = await this.quotes.latest(input.tenantId, input.quoteType, 'MANUAL');
      if (quote === undefined) {
        throw new PriceQuoteUnavailableError();
      }

      return { quote, selectedSource: 'MANUAL', outcome: 'MANUAL' };
    }

    try {
      const result = await this.fetchFromProvider(input.quoteType);

      const quote = await this.quotes.createFeed({
        tenantId: input.tenantId,
        quoteType: result.quoteType,
        amountRial: result.amountRial,
        observedAt: result.observedAt,
      });

      return { quote, selectedSource: 'FEED', outcome: 'FEED' };
    } catch (error) {
      const fallback = await this.quotes.latest(input.tenantId, input.quoteType);
      if (fallback === undefined) {
        throw new PriceQuoteUnavailableError();
      }

      return {
        quote: fallback,
        selectedSource: 'FEED',
        outcome: 'FALLBACK',
        failure: error instanceof PriceFeedTimeoutError ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
      };
    }
  }

  /**
   * تماس با provider، **بیرون از هر تراکنش دیتابیس**: انتظار تا سقف timeout
   * نباید یک اتصال دیتابیس را نگه دارد. هیچ خطایی بیرون نمی‌زند.
   */
  async attemptFeed(quoteType: PriceQuoteType): Promise<PriceFeedAttempt> {
    if (!this.provider.configured) {
      return { ok: false, failure: 'NOT_CONFIGURED' };
    }
    try {
      return { ok: true, result: await this.fetchFromProvider(quoteType) };
    } catch (error) {
      return { ok: false, failure: error instanceof PriceFeedTimeoutError ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR' };
    }
  }

  /**
   * نتیجه‌ی تلاش را ثبت می‌کند: مظنه‌ی تازه‌ی فید، یا fallback به آخرین مظنه‌ی
   * ذخیره‌شده از هر منبع. فقط شاخه‌ی موفق چیزی می‌نویسد.
   */
  async settleAttemptInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    quoteType: PriceQuoteType,
    attempt: PriceFeedAttempt,
  ): Promise<PriceFeedRefreshOutcome> {
    if (attempt.ok) {
      const quote = await this.quotes.createFeedInTransaction(transaction, {
        tenantId,
        quoteType: attempt.result.quoteType,
        amountRial: attempt.result.amountRial,
        observedAt: attempt.result.observedAt,
      });
      return { outcome: 'FEED', failure: null, quote };
    }

    const fallback = await this.quotes.latestInTransaction(transaction, tenantId, quoteType);
    return fallback === undefined
      ? { outcome: 'UNAVAILABLE', failure: attempt.failure, quote: null }
      : { outcome: 'FALLBACK', failure: attempt.failure, quote: fallback };
  }

  /** منبع فعال (منبع آخرین مظنه‌ی ذخیره‌شده) و آخرین مظنه‌ی هر منبع، بدون تماس با provider. */
  async status(tenantId: string, quoteType: PriceQuoteType): Promise<PriceFeedStatusRecord> {
    const [activeQuote, latestFeedQuote, latestManualQuote] = await Promise.all([
      this.quotes.latest(tenantId, quoteType),
      this.quotes.latest(tenantId, quoteType, 'FEED'),
      this.quotes.latest(tenantId, quoteType, 'MANUAL'),
    ]);
    return { providerConfigured: this.provider.configured, activeQuote, latestFeedQuote, latestManualQuote };
  }

  private async fetchFromProvider(quoteType: PriceQuoteType): Promise<PriceFeedResult> {
    const result = await withTimeout(this.provider.fetchLatest(), this.timeoutMs);
    if (!isValidFeedResult(result) || result.quoteType !== quoteType) {
      throw new InvalidPriceFeedResultError();
    }
    return result;
  }
}
