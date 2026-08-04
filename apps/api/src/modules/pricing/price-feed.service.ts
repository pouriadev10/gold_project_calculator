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
      const result = await withTimeout(this.provider.fetchLatest(), this.timeoutMs);
      if (!isValidFeedResult(result) || result.quoteType !== input.quoteType) {
        throw new InvalidPriceFeedResultError();
      }

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
}
