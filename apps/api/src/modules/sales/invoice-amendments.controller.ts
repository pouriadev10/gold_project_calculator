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
import { amendSalesInvoiceSchema } from '@gold/contracts';
import { CurrentAuth } from '../../platform/auth/current-user.decorator';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { IDEMPOTENCY_KEY_HEADER } from '../../platform/idempotency/idempotency-key';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import { InvoiceAmendmentsService } from './invoice-amendments.service';
import type { AmendSalesInvoiceInput, AmendedSalesInvoice } from '@gold/contracts';
import type { AccessTokenPayload } from '../../platform/auth/token.service';

const PATH = '/sales/invoices/:invoiceId/amend';

@Controller('sales/invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class InvoiceAmendmentsController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(InvoiceAmendmentsService) private readonly amendments: InvoiceAmendmentsService,
  ) {}

  @Post(':invoiceId/amend')
  @HttpCode(HttpStatus.CREATED)
  async amend(
    @Param('invoiceId') invoiceId: string,
    @Body(new ZodValidationPipe(amendSalesInvoiceSchema)) body: AmendSalesInvoiceInput,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<AmendedSalesInvoice> {
    if (auth === undefined) {
      throw new UnauthorizedException();
    }

    try {
      const tenantId = this.context.getTenantId();
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: { method: 'POST', path: PATH, body: { invoiceId, ...body } },
        execute: async (transaction) => {
          const amended = await this.amendments.amendInTransaction(transaction, {
            tenantId,
            salesInvoiceId: invoiceId,
            input: body,
            actorUserId: auth.sub,
            actorRole: auth.role,
            amendedAt: new Date(),
          });
          return {
            status: HttpStatus.CREATED,
            body: {
              invoiceId: amended.invoiceId,
              invoiceNumber: amended.invoiceNumber,
              version: amended.version,
              payableRial: amended.payableRial.toString(),
              receivableRial: amended.receivableRial.toString(),
              ledgerTransactionId: amended.ledgerTransactionId,
              inventoryMovementIds: [...amended.inventoryMovementIds],
            },
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
}
