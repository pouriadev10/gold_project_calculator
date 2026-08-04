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
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  createManualPriceQuoteSchema,
  priceQuoteQuerySchema,
} from '@gold/contracts';
import { ZodValidationPipe } from '../../shared/validation';
import { CurrentAuth } from '../../platform/auth/current-user.decorator';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { IDEMPOTENCY_KEY_HEADER } from '../../platform/idempotency/idempotency-key';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { PriceQuotesService } from './price-quotes.service';
import type {
  CreateManualPriceQuoteInput,
  PriceQuote as PriceQuoteResponse,
  PriceQuoteQuery,
} from '@gold/contracts';
import type { AccessTokenPayload } from '../../platform/auth/token.service';
import type { PriceQuote } from '../../platform/database/schema';

interface AuditHttpRequest {
  readonly ip: string;
  readonly headers: Record<string, readonly string[] | string | undefined>;
}

function auditRequestMetadata(request: AuditHttpRequest): {
  readonly ipAddress: string;
  readonly userAgent: string | null;
} {
  const userAgent = request.headers['user-agent'];

  return {
    ipAddress: request.ip,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
  };
}

function toResponse(quote: PriceQuote): PriceQuoteResponse {
  return {
    id: quote.id,
    quoteType: quote.quoteType,
    amountRial: quote.amountRial.toString(),
    source: quote.source,
    observedAt: quote.observedAt.toISOString(),
    createdBy: quote.createdBy,
    createdAt: quote.createdAt.toISOString(),
  };
}

/** Manual quote entry and tenant-scoped quote history. */
@Controller('pricing/quotes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PriceQuotesController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(PriceQuotesService) private readonly quotes: PriceQuotesService,
  ) {}

  @Post('manual')
  @HttpCode(HttpStatus.CREATED)
  @Roles('OWNER', 'MANAGER')
  async createManual(
    @Body(new ZodValidationPipe(createManualPriceQuoteSchema)) body: CreateManualPriceQuoteInput,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
    @Req() request: AuditHttpRequest,
  ): Promise<PriceQuoteResponse> {
    if (auth === undefined) {
      throw new UnauthorizedException();
    }

    const tenantId = this.context.getTenantId();
    const auditMetadata = auditRequestMetadata(request);
    try {
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: {
          method: 'POST',
          path: '/pricing/quotes/manual',
          body,
        },
        execute: async (transaction) => {
          const quote = await this.quotes.createManualInTransaction(transaction, {
            tenantId,
            quoteType: body.quoteType,
            amountRial: BigInt(body.amountRial),
            createdBy: auth.sub,
            ...auditMetadata,
          });

          return {
            status: HttpStatus.CREATED,
            body: toResponse(quote),
          };
        },
      });

      return result.response.body;
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @Get('latest')
  async latest(
    @Query(new ZodValidationPipe(priceQuoteQuerySchema)) query: PriceQuoteQuery,
  ): Promise<PriceQuoteResponse | null> {
    const quote = await this.quotes.latest(this.context.getTenantId(), query.quoteType);

    return quote === undefined ? null : toResponse(quote);
  }

  @Get()
  async list(
    @Query(new ZodValidationPipe(priceQuoteQuerySchema)) query: PriceQuoteQuery,
  ): Promise<readonly PriceQuoteResponse[]> {
    const quotes = await this.quotes.list(this.context.getTenantId(), query.quoteType);

    return quotes.map(toResponse);
  }
}
