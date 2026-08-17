import {
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { createCoinSettlementSchema, uuidSchema } from '@gold/contracts';
import { CurrentAuth } from '../../platform/auth/current-user.decorator';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { IDEMPOTENCY_KEY_HEADER } from '../../platform/idempotency/idempotency-key';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import { CoinSettlementsService } from './coin-settlements.service';
import type { AccessTokenPayload } from '../../platform/auth/token.service';
import type { CoinSettlement, CreateCoinSettlementInput } from '@gold/contracts';

const PATH = (partyId: string) => `/parties/${partyId}/settlements/coins`;

@Controller('parties/:partyId/settlements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class CoinSettlementsController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(CoinSettlementsService) private readonly settlements: CoinSettlementsService,
  ) {}

  @Post('coins')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('partyId', new ZodValidationPipe(uuidSchema)) partyId: string,
    @Body(new ZodValidationPipe(createCoinSettlementSchema)) body: CreateCoinSettlementInput,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<CoinSettlement> {
    if (auth === undefined) throw new UnauthorizedException();

    try {
      const tenantId = this.context.getTenantId();
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: { method: 'POST', path: PATH(partyId), body },
        execute: async (transaction) => {
          const created = await this.settlements.createInTransaction(transaction, {
            tenantId,
            partyId,
            coinTypeId: body.coinTypeId,
            count: body.count,
            marketUnitPriceRial: BigInt(body.marketUnitPriceRial),
            quoteId: body.quoteId,
            effectiveAt: new Date(body.effectiveAt),
            createdBy: auth.sub,
          });

          return {
            status: HttpStatus.CREATED,
            body: {
              settlementId: created.settlementId,
              ledgerTransactionId: created.ledgerTransactionId,
              inventoryMovementId: created.inventoryMovementId,
              coinTypeId: created.coinTypeId,
              count: created.count,
              settledRial: created.settledRial.toString(),
              intrinsicValueRial: created.intrinsicValueRial.toString(),
              bubbleRial: created.bubbleRial === null ? null : created.bubbleRial.toString(),
            },
          };
        },
      });

      return result.response.body;
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) throw new ConflictException(error.message);
      throw error;
    }
  }
}
