import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { amendSalesInvoiceSchema, uuidSchema } from '@gold/contracts';
import { CurrentAuth } from '../../platform/auth/current-user.decorator';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { IDEMPOTENCY_KEY_HEADER } from '../../platform/idempotency/idempotency-key';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import { InvoiceAmendmentPolicyDeniedError } from './invoice-amendment-policy.errors';
import { InvoiceAmendmentsService } from './invoice-amendments.service';
import { SalesInvoiceNotFoundError } from './sales-invoices.errors';
import type {
  AmendSalesInvoiceInput,
  AmendedSalesInvoice,
  InvoiceAmendmentPreflight,
} from '@gold/contracts';
import type { AccessTokenPayload } from '../../platform/auth/token.service';
import type { InvoiceAmendmentRestriction } from './invoice-amendment-policy.errors';

const PATH = '/sales/invoices/:invoiceId/amend';

const RESTRICTION_LABELS: Readonly<Record<InvoiceAmendmentRestriction, string>> = {
  OUTSIDE_CORRECTION_WINDOW: 'پنجره‌ی اصلاح بسته شده است',
  BUSINESS_DAY_CLOSED: 'روز کاری بسته شده است',
  SETTLED_INVOICE: 'فاکتور تسویه شده است',
  VARIANCE_EXCEEDS_MANAGER_THRESHOLD: 'اختلاف مبلغ از حد مجاز صندوقدار بیشتر است',
};

function policyDeniedMessage(restrictions: readonly InvoiceAmendmentRestriction[]): string {
  return `اصلاح این فاکتور تأیید مدیر یا مالک لازم دارد: ${restrictions.map((restriction) => RESTRICTION_LABELS[restriction]).join('، ')}`;
}

@Controller('sales/invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class InvoiceAmendmentsController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(InvoiceAmendmentsService) private readonly amendments: InvoiceAmendmentsService,
  ) {}

  @Get(':invoiceId/amendment-policy')
  async getPreflight(
    @Param('invoiceId', new ZodValidationPipe(uuidSchema)) invoiceId: string,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
  ): Promise<InvoiceAmendmentPreflight> {
    if (auth === undefined) throw new UnauthorizedException();
    try {
      return await this.amendments.getPreflight(this.context.getTenantId(), invoiceId, auth.role);
    } catch (error) {
      if (error instanceof SalesInvoiceNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }

  @Post(':invoiceId/amend')
  @HttpCode(HttpStatus.CREATED)
  async amend(
    // همان اعتبارسنجی ِ مسیر preflight (M-16): پیش‌تر شناسه‌ی ناسالم تا کوئری دیتابیس می‌رسید.
    @Param('invoiceId', new ZodValidationPipe(uuidSchema)) invoiceId: string,
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
              invoicePeriod: amended.invoicePeriod,
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
      // قاعده‌ی کسب‌وکار، نه خطای سرور: صندوقدار باید بداند تأیید مدیر لازم است (BE-072).
      if (error instanceof InvoiceAmendmentPolicyDeniedError) {
        throw new ForbiddenException(policyDeniedMessage(error.restrictions));
      }
      throw error;
    }
  }
}
