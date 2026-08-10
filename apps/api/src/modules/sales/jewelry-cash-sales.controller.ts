import { Body, ConflictException, Controller, Headers, HttpCode, HttpStatus, Inject, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { createJewelryCashSaleSchema } from '@gold/contracts';
import { CurrentAuth } from '../../platform/auth/current-user.decorator';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { IDEMPOTENCY_KEY_HEADER } from '../../platform/idempotency/idempotency-key';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import { JewelryCashSalesService } from './jewelry-cash-sales.service';
import type { CreateJewelryCashSaleInput, JewelryCashSale } from '@gold/contracts';
import type { AccessTokenPayload } from '../../platform/auth/token.service';

const PATH = '/sales/invoices/jewelry';

@Controller('sales/invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class JewelryCashSalesController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(JewelryCashSalesService) private readonly sales: JewelryCashSalesService,
  ) {}

  @Post('jewelry')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(createJewelryCashSaleSchema)) body: CreateJewelryCashSaleInput,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<JewelryCashSale> {
    if (auth === undefined) throw new UnauthorizedException();
    try {
      const result = await this.idempotency.execute({
        tenantId: this.context.getTenantId(),
        key,
        request: { method: 'POST', path: PATH, body },
        execute: async (transaction) => {
          const created = await this.sales.createInTransaction(transaction, {
            tenantId: this.context.getTenantId(),
            partyId: body.partyId,
            jewelryItemId: body.jewelryItemId,
            quoteId: body.quoteId,
            effectiveAt: new Date(body.effectiveAt),
            createdBy: auth.sub,
          });
          return {
            status: HttpStatus.CREATED,
            body: {
              invoiceId: created.invoiceId,
              invoiceNumber: created.invoiceNumber,
              payableRial: created.payableRial.toString(),
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
