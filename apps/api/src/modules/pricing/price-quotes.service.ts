import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../../platform/audit/audit.service';
import { DRIZZLE } from '../../platform/database/database.module';
import { priceQuotes } from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import type { Database } from '../../platform/database/connect';
import type {
  PriceQuote,
  PriceQuoteSource,
  PriceQuoteType,
} from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

export interface CreateManualPriceQuoteInput {
  readonly tenantId: string;
  readonly quoteType: PriceQuoteType;
  readonly amountRial: bigint;
  readonly createdBy: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface CreateFeedPriceQuoteInput {
  readonly tenantId: string;
  readonly quoteType: PriceQuoteType;
  readonly amountRial: bigint;
  readonly observedAt: Date;
}

function quoteScope(
  tenantId: string,
  quoteType: PriceQuoteType | undefined,
  source: PriceQuoteSource | undefined,
) {
  if (quoteType === undefined) {
    return source === undefined
      ? eq(priceQuotes.tenantId, tenantId)
      : and(eq(priceQuotes.tenantId, tenantId), eq(priceQuotes.source, source));
  }

  return source === undefined
    ? and(eq(priceQuotes.tenantId, tenantId), eq(priceQuotes.quoteType, quoteType))
    : and(
        eq(priceQuotes.tenantId, tenantId),
        eq(priceQuotes.quoteType, quoteType),
        eq(priceQuotes.source, source),
      );
}

/**
 * Append-only market quote history. Financial documents will later snapshot a
 * selected quote; this service never exposes mutation or deletion operations.
 */
@Injectable()
export class PriceQuotesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async createManual(input: CreateManualPriceQuoteInput): Promise<PriceQuote> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.createManualInTransaction(transaction, input),
    );
  }

  async createManualInTransaction(
    transaction: TenantTransaction,
    input: CreateManualPriceQuoteInput,
  ): Promise<PriceQuote> {
    const [created] = await transaction
      .insert(priceQuotes)
      .values({
        tenantId: input.tenantId,
        quoteType: input.quoteType,
        amountRial: input.amountRial,
        source: 'MANUAL',
        createdBy: input.createdBy,
      })
      .returning();
    const quote = created!;

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: input.createdBy,
      action: 'PRICE_QUOTE_MANUAL_CREATED',
      entityType: 'price_quote',
      entityId: quote.id,
      afterData: {
        quoteType: quote.quoteType,
        amountRial: quote.amountRial.toString(),
        source: quote.source,
        observedAt: quote.observedAt.toISOString(),
      },
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });

    return quote;
  }

  async createFeed(input: CreateFeedPriceQuoteInput): Promise<PriceQuote> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.createFeedInTransaction(transaction, input),
    );
  }

  async createFeedInTransaction(
    transaction: TenantTransaction,
    input: CreateFeedPriceQuoteInput,
  ): Promise<PriceQuote> {
    const [created] = await transaction
      .insert(priceQuotes)
      .values({
        tenantId: input.tenantId,
        quoteType: input.quoteType,
        amountRial: input.amountRial,
        source: 'FEED',
        observedAt: input.observedAt,
        createdBy: null,
      })
      .returning();
    const quote = created!;

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: null,
      action: 'PRICE_QUOTE_FEED_CREATED',
      entityType: 'price_quote',
      entityId: quote.id,
      afterData: {
        quoteType: quote.quoteType,
        amountRial: quote.amountRial.toString(),
        source: quote.source,
        observedAt: quote.observedAt.toISOString(),
      },
    });

    return quote;
  }

  async list(tenantId: string, quoteType?: PriceQuoteType): Promise<readonly PriceQuote[]> {
    return withTenantTransaction(this.db, tenantId, (transaction) =>
      this.listInTransaction(transaction, tenantId, quoteType),
    );
  }

  async listInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    quoteType?: PriceQuoteType,
  ): Promise<readonly PriceQuote[]> {
    return transaction
      .select()
      .from(priceQuotes)
      .where(
        quoteType === undefined
          ? eq(priceQuotes.tenantId, tenantId)
          : and(eq(priceQuotes.tenantId, tenantId), eq(priceQuotes.quoteType, quoteType)),
      )
      .orderBy(desc(priceQuotes.observedAt), desc(priceQuotes.createdAt), desc(priceQuotes.id));
  }

  async latest(
    tenantId: string,
    quoteType?: PriceQuoteType,
    source?: PriceQuoteSource,
  ): Promise<PriceQuote | undefined> {
    return withTenantTransaction(this.db, tenantId, (transaction) =>
      this.latestInTransaction(transaction, tenantId, quoteType, source),
    );
  }

  async latestInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    quoteType?: PriceQuoteType,
    source?: PriceQuoteSource,
  ): Promise<PriceQuote | undefined> {
    const [latest] = await transaction
      .select()
      .from(priceQuotes)
      .where(quoteScope(tenantId, quoteType, source))
      .orderBy(desc(priceQuotes.observedAt), desc(priceQuotes.createdAt), desc(priceQuotes.id))
      .limit(1);

    return latest;
  }
}
