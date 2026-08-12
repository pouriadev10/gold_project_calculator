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
import { createRialSettlementSchema, uuidSchema } from '@gold/contracts';
import { CurrentAuth } from '../../platform/auth/current-user.decorator';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { IDEMPOTENCY_KEY_HEADER } from '../../platform/idempotency/idempotency-key';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import { RialSettlementsService } from './rial-settlements.service';
import type { CreateRialSettlementInput, RialSettlement } from '@gold/contracts';
import type { AccessTokenPayload } from '../../platform/auth/token.service';

@Controller('parties/:partyId/settlements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class RialSettlementsController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(RialSettlementsService) private readonly settlements: RialSettlementsService,
  ) {}

  @Post('rial')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('partyId', new ZodValidationPipe(uuidSchema)) partyId: string,
    @Body(new ZodValidationPipe(createRialSettlementSchema)) body: CreateRialSettlementInput,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<RialSettlement> {
    if (auth === undefined) throw new UnauthorizedException();
    try {
      const tenantId = this.context.getTenantId();
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: { method: 'POST', path: `/parties/${partyId}/settlements/rial`, body },
        execute: async (transaction) => {
          const created = await this.settlements.createInTransaction(transaction, {
            tenantId,
            partyId,
            amountRial: BigInt(body.amountRial),
            effectiveAt: new Date(body.effectiveAt),
            createdBy: auth.sub,
          });
          return {
            status: HttpStatus.CREATED,
            body: {
              settlementId: created.settlementId,
              ledgerTransactionId: created.ledgerTransactionId,
              amountRial: body.amountRial,
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
