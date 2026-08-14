import {
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { createCoinSaleSchema } from '@gold/contracts';
import { CurrentAuth } from '../../platform/auth/current-user.decorator';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { IDEMPOTENCY_KEY_HEADER } from '../../platform/idempotency/idempotency-key';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import { CoinSalesService } from './coin-sales.service';
import type { CoinSale, CreateCoinSaleInput } from '@gold/contracts';
import type { AccessTokenPayload } from '../../platform/auth/token.service';

const PATH = '/sales/invoices/coins';

@Controller('sales/invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class CoinSalesController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(CoinSalesService) private readonly sales: CoinSalesService,
  ) {}

  @Post('coins')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(createCoinSaleSchema)) body: CreateCoinSaleInput,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<CoinSale> {
    if (auth === undefined) throw new UnauthorizedException();
    try {
      const tenantId = this.context.getTenantId();
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: { method: 'POST', path: PATH, body },
        execute: async (transaction) => {
          const created = await this.sales.createInTransaction(transaction, {
            tenantId,
            partyId: body.partyId,
            coinTypeId: body.coinTypeId,
            count: body.count,
            marketUnitPriceRial: BigInt(body.marketUnitPriceRial),
            quoteId: body.quoteId,
            effectiveAt: new Date(body.effectiveAt),
            paidRial: BigInt(body.paidRial),
            createdBy: auth.sub,
          });
          return {
            status: HttpStatus.CREATED,
            body: {
              invoiceId: created.invoiceId,
              invoiceNumber: created.invoiceNumber,
              payableRial: created.payableRial.toString(),
              receivableRial: created.receivableRial.toString(),
              intrinsicValueRial: created.intrinsicValueRial.toString(),
              bubbleRial: created.bubbleRial === null ? null : created.bubbleRial.toString(),
              ledgerTransactionId: created.ledgerTransactionId,
              inventoryMovementId: created.inventoryMovementId,
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
