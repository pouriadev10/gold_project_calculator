import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { priceFeedStatusQuerySchema, refreshPriceFeedSchema } from '@gold/contracts';
import { CurrentAuth } from '../../platform/auth/current-user.decorator';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { IDEMPOTENCY_KEY_HEADER } from '../../platform/idempotency/idempotency-key';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import { PriceFeedService } from './price-feed.service';
import { toPriceQuoteResponse } from './price-quotes.controller';
import type {
  PriceFeedRefreshResult,
  PriceFeedStatus,
  PriceFeedStatusQuery,
  RefreshPriceFeedInput,
} from '@gold/contracts';
import type { AccessTokenPayload } from '../../platform/auth/token.service';
import type { PriceFeedRefreshOutcome } from './price-feed.service';

export function toRefreshResponse(outcome: PriceFeedRefreshOutcome): PriceFeedRefreshResult {
  switch (outcome.outcome) {
    case 'FEED':
      return { outcome: 'FEED', failure: null, quote: toPriceQuoteResponse(outcome.quote) };
    case 'FALLBACK':
      return { outcome: 'FALLBACK', failure: outcome.failure, quote: toPriceQuoteResponse(outcome.quote) };
    case 'UNAVAILABLE':
      return { outcome: 'UNAVAILABLE', failure: outcome.failure, quote: null };
  }
}

/**
 * منبع مظنه و وضعیت فید — FE-082.
 *
 * وضعیت برای هر سه نقش خواندنی است (صندوقدار هم باید بداند مظنه از کجا
 * آمده)؛ «دریافت از فید» یک مظنه‌ی تازه می‌نویسد، پس فقط OWNER/MANAGER با
 * `Idempotency-Key`. تماس با provider پیش از تراکنش انجام می‌شود تا انتظار
 * فید اتصال دیتابیس را نگه ندارد؛ در تکرار همان کلید، پاسخ ذخیره‌شده‌ی
 * تلاش اول برمی‌گردد و نتیجه‌ی تماس تازه دور ریخته می‌شود.
 *
 * هیچ مسیر فروش یا خریدی به این controller وابسته نیست: معامله با شناسه‌ی
 * مظنه‌ی ذخیره‌شده (`quoteId`) قیمت می‌خورد.
 */
@Controller('pricing/feed')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PriceFeedController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(PriceFeedService) private readonly feed: PriceFeedService,
  ) {}

  @Get('status')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  async status(
    @Query(new ZodValidationPipe(priceFeedStatusQuerySchema)) query: PriceFeedStatusQuery,
  ): Promise<PriceFeedStatus> {
    const status = await this.feed.status(this.context.getTenantId(), query.quoteType);
    const orNull = (quote: typeof status.activeQuote) => (quote === undefined ? null : toPriceQuoteResponse(quote));
    return {
      quoteType: query.quoteType,
      providerConfigured: status.providerConfigured,
      activeQuote: orNull(status.activeQuote),
      latestFeedQuote: orNull(status.latestFeedQuote),
      latestManualQuote: orNull(status.latestManualQuote),
      checkedAt: new Date().toISOString(),
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER', 'MANAGER')
  async refresh(
    @Body(new ZodValidationPipe(refreshPriceFeedSchema)) body: RefreshPriceFeedInput,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<PriceFeedRefreshResult> {
    if (auth === undefined) throw new UnauthorizedException();

    const tenantId = this.context.getTenantId();
    const attempt = await this.feed.attemptFeed(body.quoteType);
    try {
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: { method: 'POST', path: '/pricing/feed/refresh', body },
        execute: async (transaction) => ({
          status: HttpStatus.OK,
          body: toRefreshResponse(
            await this.feed.settleAttemptInTransaction(transaction, tenantId, body.quoteType, attempt),
          ),
        }),
      });
      return result.response.body;
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) throw new ConflictException(error.message);
      throw error;
    }
  }
}
