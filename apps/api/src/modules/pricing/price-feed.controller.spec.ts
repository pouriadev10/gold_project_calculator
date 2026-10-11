import 'reflect-metadata';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { priceFeedRefreshResultSchema, priceFeedStatusSchema } from '@gold/contracts';
import { ROLES_METADATA_KEY } from '../../platform/auth/roles.decorator';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { PriceFeedController } from './price-feed.controller';
import { UnavailablePriceFeedProvider } from './price-feed.provider';
import { PriceFeedService } from './price-feed.service';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import type { RequestContextService } from '../../platform/request-context/request-context.service';
import type { PriceQuote } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';
import type { PriceFeedProvider, PriceFeedResult } from './price-feed.provider';
import type { PriceQuotesService } from './price-quotes.service';

/** FE-082 — وضعیت منبع مظنه و «دریافت از فید» با fallback. */

const TENANT = 'a0000000-0000-4000-8000-000000000001';
const USER = 'b0000000-0000-4000-8000-000000000001';
const OBSERVED = new Date('2026-10-11T08:00:00.000Z');

function quote(source: PriceQuote['source'], overrides: Partial<PriceQuote> = {}): PriceQuote {
  return {
    id: source === 'FEED' ? 'c0000000-0000-4000-8000-00000000000f' : 'c0000000-0000-4000-8000-00000000000a',
    tenantId: TENANT,
    quoteType: 'MAZNEH',
    amountRial: 412_000_000n,
    source,
    observedAt: OBSERVED,
    createdBy: source === 'MANUAL' ? USER : null,
    createdAt: OBSERVED,
    ...overrides,
  } as PriceQuote;
}

const transaction = {} as TenantTransaction;

function provider(fetchLatest: () => Promise<PriceFeedResult>, configured = true): PriceFeedProvider {
  return { configured, fetchLatest };
}

function service(
  feedProvider: PriceFeedProvider,
  quotes: Partial<Record<keyof PriceQuotesService, unknown>> = {},
  timeoutMs = 50,
) {
  return new PriceFeedService(quotes as unknown as PriceQuotesService, feedProvider, timeoutMs);
}

describe('PriceFeedService.attemptFeed — never throws, never touches the database', () => {
  it('reports NOT_CONFIGURED without calling an unconfigured provider', async () => {
    const fetchLatest = vi.fn(async () => Promise.reject(new Error('x')));
    expect(await service(provider(fetchLatest, false)).attemptFeed('MAZNEH')).toEqual({
      ok: false,
      failure: 'NOT_CONFIGURED',
    });
    expect(fetchLatest).not.toHaveBeenCalled();
    expect(new UnavailablePriceFeedProvider().configured).toBe(false);
  });

  it('returns a validated result', async () => {
    const result = { quoteType: 'MAZNEH' as const, amountRial: 415_000_000n, observedAt: OBSERVED };
    expect(await service(provider(async () => result)).attemptFeed('MAZNEH')).toEqual({ ok: true, result });
  });

  it('classifies provider errors, invalid results and timeouts', async () => {
    expect(await service(provider(async () => Promise.reject(new Error('down')))).attemptFeed('MAZNEH')).toEqual({
      ok: false,
      failure: 'PROVIDER_ERROR',
    });
    const invalid = { quoteType: 'MAZNEH' as const, amountRial: 0n, observedAt: OBSERVED };
    expect(await service(provider(async () => invalid)).attemptFeed('MAZNEH')).toEqual({
      ok: false,
      failure: 'PROVIDER_ERROR',
    });
    const never = () => new Promise<PriceFeedResult>(() => undefined);
    expect(await service(provider(never), {}, 5).attemptFeed('MAZNEH')).toEqual({
      ok: false,
      failure: 'PROVIDER_TIMEOUT',
    });
  });
});

describe('PriceFeedService.settleAttemptInTransaction', () => {
  it('stores a fresh feed quote on success', async () => {
    const createFeedInTransaction = vi.fn(async () => quote('FEED'));
    const outcome = await service(provider(vi.fn()), { createFeedInTransaction }).settleAttemptInTransaction(
      transaction,
      TENANT,
      'MAZNEH',
      { ok: true, result: { quoteType: 'MAZNEH', amountRial: 412_000_000n, observedAt: OBSERVED } },
    );
    expect(outcome).toEqual({ outcome: 'FEED', failure: null, quote: quote('FEED') });
    expect(createFeedInTransaction).toHaveBeenCalledWith(transaction, {
      tenantId: TENANT,
      quoteType: 'MAZNEH',
      amountRial: 412_000_000n,
      observedAt: OBSERVED,
    });
  });

  it('falls back to the latest stored quote of any source, writing nothing', async () => {
    const createFeedInTransaction = vi.fn();
    const latestInTransaction = vi.fn(async () => quote('MANUAL'));
    const outcome = await service(provider(vi.fn()), {
      createFeedInTransaction,
      latestInTransaction,
    }).settleAttemptInTransaction(transaction, TENANT, 'MAZNEH', { ok: false, failure: 'PROVIDER_TIMEOUT' });
    expect(outcome).toEqual({ outcome: 'FALLBACK', failure: 'PROVIDER_TIMEOUT', quote: quote('MANUAL') });
    expect(latestInTransaction).toHaveBeenCalledWith(transaction, TENANT, 'MAZNEH');
    expect(createFeedInTransaction).not.toHaveBeenCalled();
  });

  it('is UNAVAILABLE when there is nothing to fall back to', async () => {
    const outcome = await service(provider(vi.fn()), {
      latestInTransaction: vi.fn(async () => undefined),
    }).settleAttemptInTransaction(transaction, TENANT, 'MAZNEH', { ok: false, failure: 'NOT_CONFIGURED' });
    expect(outcome).toEqual({ outcome: 'UNAVAILABLE', failure: 'NOT_CONFIGURED', quote: null });
  });
});

describe('PriceFeedController', () => {
  const context = { getTenantId: () => TENANT } as RequestContextService;
  const auth = { sub: USER, tid: TENANT, role: 'MANAGER' as const };

  it('lets every role read the status but only OWNER and MANAGER refresh', () => {
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, PriceFeedController.prototype.status)).toEqual([
      'OWNER',
      'MANAGER',
      'CASHIER',
    ]);
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, PriceFeedController.prototype.refresh)).toEqual(['OWNER', 'MANAGER']);
  });

  it('reports the active source as the source of the latest stored quote', async () => {
    const latest = vi.fn(async (_tenant: string, _type: string, source?: string) =>
      source === 'FEED' ? undefined : quote('MANUAL'),
    );
    const controller = new PriceFeedController(
      context,
      {} as IdempotencyService,
      service(new UnavailablePriceFeedProvider(), { latest }),
    );

    const status = await controller.status({ quoteType: 'MAZNEH' });

    expect(priceFeedStatusSchema.parse(status)).toEqual(status);
    expect(status).toMatchObject({
      providerConfigured: false,
      activeQuote: { source: 'MANUAL', amountRial: '412000000' },
      latestFeedQuote: null,
      latestManualQuote: { source: 'MANUAL' },
    });
    expect(latest).toHaveBeenCalledWith(TENANT, 'MAZNEH');
  });

  it('calls the provider before the idempotent transaction and returns the settled outcome', async () => {
    const order: string[] = [];
    const feed = {
      attemptFeed: vi.fn(async () => {
        order.push('provider');
        return { ok: false as const, failure: 'PROVIDER_ERROR' as const };
      }),
      settleAttemptInTransaction: vi.fn(async () => ({
        outcome: 'FALLBACK' as const,
        failure: 'PROVIDER_ERROR' as const,
        quote: quote('MANUAL'),
      })),
    };
    const execute = vi.fn(async (input: { execute: (tx: TenantTransaction) => Promise<{ body: unknown }> }) => {
      order.push('transaction');
      return { response: await input.execute(transaction) };
    });
    const controller = new PriceFeedController(
      context,
      { execute } as unknown as IdempotencyService,
      feed as unknown as PriceFeedService,
    );

    const result = await controller.refresh({ quoteType: 'MAZNEH' }, auth, 'key-1');

    expect(order).toEqual(['provider', 'transaction']);
    expect(priceFeedRefreshResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ outcome: 'FALLBACK', failure: 'PROVIDER_ERROR', quote: { source: 'MANUAL' } });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, key: 'key-1', request: expect.objectContaining({ path: '/pricing/feed/refresh' }) }),
    );
  });

  it('requires authentication and maps an idempotency conflict to 409', async () => {
    const controller = (error: Error) =>
      new PriceFeedController(
        context,
        { execute: vi.fn(async () => Promise.reject(error)) } as unknown as IdempotencyService,
        { attemptFeed: vi.fn(async () => ({ ok: false, failure: 'NOT_CONFIGURED' })) } as unknown as PriceFeedService,
      );
    await expect(controller(new Error('x')).refresh({ quoteType: 'MAZNEH' }, undefined, 'k')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      controller(new IdempotencyKeyConflictError()).refresh({ quoteType: 'MAZNEH' }, auth, 'k'),
    ).rejects.toBeInstanceOf(ConflictException);
    const unexpected = new Error('db down');
    await expect(controller(unexpected).refresh({ quoteType: 'MAZNEH' }, auth, 'k')).rejects.toBe(unexpected);
  });
});
