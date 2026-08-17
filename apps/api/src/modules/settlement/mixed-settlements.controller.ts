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
import { createMixedSettlementSchema, uuidSchema } from '@gold/contracts';
import { CurrentAuth } from '../../platform/auth/current-user.decorator';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { IDEMPOTENCY_KEY_HEADER } from '../../platform/idempotency/idempotency-key';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import { MixedSettlementsService } from './mixed-settlements.service';
import type { AccessTokenPayload } from '../../platform/auth/token.service';
import type { CreateMixedSettlementInput, MixedSettlement } from '@gold/contracts';

const PATH = (partyId: string) => `/parties/${partyId}/settlements/mixed`;

@Controller('parties/:partyId/settlements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class MixedSettlementsController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(MixedSettlementsService) private readonly settlements: MixedSettlementsService,
  ) {}

  @Post('mixed')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('partyId', new ZodValidationPipe(uuidSchema)) partyId: string,
    @Body(new ZodValidationPipe(createMixedSettlementSchema)) body: CreateMixedSettlementInput,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<MixedSettlement> {
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
            effectiveAt: new Date(body.effectiveAt),
            createdBy: auth.sub,
            lines: body.lines.map((line) => {
              switch (line.type) {
                case 'RIAL':
                case 'CREDIT':
                  return { type: line.type, amountRial: BigInt(line.amountRial) };
                case 'GOLD':
                  return {
                    type: 'GOLD',
                    grossWeightMg: BigInt(line.grossWeightMg),
                    karat: line.karat,
                    quoteId: line.quoteId,
                  };
                case 'COIN':
                  return {
                    type: 'COIN',
                    coinTypeId: line.coinTypeId,
                    count: line.count,
                    marketUnitPriceRial: BigInt(line.marketUnitPriceRial),
                    quoteId: line.quoteId,
                  };
              }
            }),
          });

          return {
            status: HttpStatus.CREATED,
            body: {
              settlementId: created.settlementId,
              ledgerTransactionId: created.ledgerTransactionId,
              totalSettledRial: created.totalSettledRial.toString(),
              lines: created.lines.map((line) => {
                switch (line.type) {
                  case 'RIAL':
                    return { type: 'RIAL' as const, settledRial: line.settledRial.toString() };
                  case 'GOLD':
                    return {
                      type: 'GOLD' as const,
                      inventoryMovementId: line.inventoryMovementId,
                      pureWeightMg: line.pureWeightMg.toString(),
                      settledRial: line.settledRial.toString(),
                      goldRatePerGramRial: line.goldRatePerGramRial.toString(),
                    };
                  case 'COIN':
                    return {
                      type: 'COIN' as const,
                      inventoryMovementId: line.inventoryMovementId,
                      coinTypeId: line.coinTypeId,
                      count: line.count,
                      settledRial: line.settledRial.toString(),
                      intrinsicValueRial: line.intrinsicValueRial.toString(),
                      bubbleRial: line.bubbleRial === null ? null : line.bubbleRial.toString(),
                    };
                  case 'CREDIT':
                    return { type: 'CREDIT' as const, settledRial: line.settledRial.toString() };
                }
              }),
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
