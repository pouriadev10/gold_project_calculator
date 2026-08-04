import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PriceQuoteUnavailableError } from '../src/modules/pricing/price-feed.errors';
import {
  PRICE_FEED_PROVIDER,
  PRICE_FEED_TIMEOUT_MS,
} from '../src/modules/pricing/price-feed.provider';
import { PriceFeedService } from '../src/modules/pricing/price-feed.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import { auditLogs, priceQuotes, tenants } from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import type { Database } from '../src/platform/database/connect';
import type { PriceQuote, PriceQuoteType } from '../src/platform/database/schema';
import type { PriceFeedProvider, PriceFeedResult } from '../src/modules/pricing/price-feed.provider';
import type { INestApplicationContext } from '@nestjs/common';

class ControlledPriceFeedProvider implements PriceFeedProvider {
  calls = 0;
  response: () => Promise<PriceFeedResult> = async () => {
    throw new Error('provider not configured for this test');
  };

  fetchLatest(): Promise<PriceFeedResult> {
    this.calls += 1;
    return this.response();
  }
}

function neverSettles(): Promise<PriceFeedResult> {
  return new Promise<PriceFeedResult>((resolve) => {
    void resolve;
  });
}

/** Feed abstraction with a real quote store and a controlled non-vendor provider. */
describe('price feed fallback (requires real PostgreSQL)', () => {
  const tenant = { id: '', slug: `feed-${randomUUID().slice(0, 12)}` };
  const provider = new ControlledPriceFeedProvider();

  let app: INestApplicationContext;
  let db: Database;
  let feeds: PriceFeedService;

  async function insertManualQuote(amountRial: bigint, observedAt: Date): Promise<PriceQuote> {
    return withTenantTransaction(db, tenant.id, async (transaction) => {
      const [created] = await transaction
        .insert(priceQuotes)
        .values({
          tenantId: tenant.id,
          quoteType: 'MAZNEH',
          amountRial,
          source: 'MANUAL',
          observedAt,
          createdBy: null,
        })
        .returning();

      return created!;
    });
  }

  const resolveFeed = () =>
    feeds.resolveLatest({
      tenantId: tenant.id,
      quoteType: 'MAZNEH' as PriceQuoteType,
      selectedSource: 'FEED',
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PRICE_FEED_PROVIDER)
      .useValue(provider)
      .overrideProvider(PRICE_FEED_TIMEOUT_MS)
      .useValue(5)
      .compile();
    app = await moduleRef.init();
    db = app.get<Database>(DRIZZLE);
    feeds = app.get(PriceFeedService);

    const [created] = await db
      .insert(tenants)
      .values({ name: 'مستأجر آزمون فید مظنه', slug: tenant.slug })
      .returning();
    tenant.id = created!.id;
  });

  afterAll(async () => {
    if (tenant.id !== '') {
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
    }
    await app?.close();
  });

  it('stores a successful provider result as a FEED quote with audit evidence', async () => {
    const observedAt = new Date('2030-01-01T00:00:00.000Z');
    provider.calls = 0;
    provider.response = async () => ({
      quoteType: 'MAZNEH',
      amountRial: 9007199254740993n,
      observedAt,
    });

    const resolution = await resolveFeed();

    expect(resolution).toMatchObject({
      selectedSource: 'FEED',
      outcome: 'FEED',
      quote: { amountRial: 9007199254740993n, source: 'FEED', observedAt },
    });
    expect(provider.calls).toBe(1);
    const records = await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'PRICE_QUOTE_FEED_CREATED')),
    );
    expect(records).toContainEqual(
      expect.objectContaining({
        entityId: resolution.quote.id,
        afterData: expect.objectContaining({ amountRial: '9007199254740993', source: 'FEED' }),
      }),
    );
  });

  it('falls back to the newest stored quote when the provider fails', async () => {
    const manual = await insertManualQuote(123456789n, new Date('2100-01-01T00:00:00.000Z'));
    provider.calls = 0;
    provider.response = async () => {
      throw new Error('provider unreachable');
    };

    const resolution = await resolveFeed();

    expect(resolution).toEqual({
      quote: manual,
      selectedSource: 'FEED',
      outcome: 'FALLBACK',
      failure: 'PROVIDER_ERROR',
    });
    expect(provider.calls).toBe(1);
  });

  it('times out a stalled provider and still returns the latest valid quote', async () => {
    const manual = await insertManualQuote(987654321n, new Date('2200-01-01T00:00:00.000Z'));
    provider.calls = 0;
    provider.response = neverSettles;

    const resolution = await resolveFeed();

    expect(resolution).toEqual({
      quote: manual,
      selectedSource: 'FEED',
      outcome: 'FALLBACK',
      failure: 'PROVIDER_TIMEOUT',
    });
    expect(provider.calls).toBe(1);
  });

  it('honors an explicit MANUAL selection without touching the provider', async () => {
    const manual = await insertManualQuote(111222333n, new Date('2300-01-01T00:00:00.000Z'));
    provider.calls = 0;
    provider.response = async () => {
      throw new Error('must not be called');
    };

    const resolution = await feeds.resolveLatest({
      tenantId: tenant.id,
      quoteType: 'MAZNEH',
      selectedSource: 'MANUAL',
    });

    expect(resolution).toEqual({ quote: manual, selectedSource: 'MANUAL', outcome: 'MANUAL' });
    expect(provider.calls).toBe(0);
  });

  it('reports an unavailable quote only after both feed and fallback are absent', async () => {
    const emptyTenant = { id: '', slug: `feed-empty-${randomUUID().slice(0, 12)}` };
    const [created] = await db
      .insert(tenants)
      .values({ name: 'مستأجر بدون مظنه', slug: emptyTenant.slug })
      .returning();
    emptyTenant.id = created!.id;
    provider.response = async () => {
      throw new Error('provider unreachable');
    };

    await expect(
      feeds.resolveLatest({ tenantId: emptyTenant.id, quoteType: 'MAZNEH', selectedSource: 'FEED' }),
    ).rejects.toBeInstanceOf(PriceQuoteUnavailableError);

    await db.delete(tenants).where(eq(tenants.id, emptyTenant.id));
  });
});
