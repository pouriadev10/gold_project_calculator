import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
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
import { createB2cBuybackSchema, uuidSchema } from '@gold/contracts';
import { CurrentAuth } from '../../platform/auth/current-user.decorator';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { IDEMPOTENCY_KEY_HEADER } from '../../platform/idempotency/idempotency-key';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import {
  B2cBuybackInvoiceNotFinalizedError,
  B2cBuybackInvoiceNotFoundError,
  B2cBuybackPartyNotAvailableError,
  B2cBuybackPartyNotConsumerError,
  B2cBuybackSourceItemsUnsupportedError,
  B2cBuybackSourceSnapshotInvalidError,
  B2cBuybackSourceSnapshotMismatchError,
} from './b2c-buybacks.errors';
import { B2cBuybacksService } from './b2c-buybacks.service';
import {
  SecondHandPurchaseCalculationError,
  SecondHandPurchasePaidRialExceedsAmountError,
  SecondHandPurchasePricingSettingInvalidError,
  SecondHandPurchaseQuoteNotFoundError,
} from './second-hand-gold-purchases.errors';
import type { AccessTokenPayload } from '../../platform/auth/token.service';
import type { B2cBuyback, CreateB2cBuybackInput } from '@gold/contracts';

const PATH_PREFIX = '/sales/invoices';

@Controller('sales/invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class B2cBuybacksController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(B2cBuybacksService) private readonly buybacks: B2cBuybacksService,
  ) {}

  @Post(':invoiceId/b2c-buyback')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('invoiceId', new ZodValidationPipe(uuidSchema)) invoiceId: string,
    @Body(new ZodValidationPipe(createB2cBuybackSchema)) body: CreateB2cBuybackInput,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<B2cBuyback> {
    if (auth === undefined) throw new UnauthorizedException();

    try {
      const tenantId = this.context.getTenantId();
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: {
          method: 'POST',
          path: `${PATH_PREFIX}/${invoiceId}/b2c-buyback`,
          body,
        },
        execute: async (transaction) => {
          const created = await this.buybacks.createInTransaction(transaction, {
            tenantId,
            sourceInvoiceId: invoiceId,
            grossWeightMg: BigInt(body.grossWeightMg),
            stoneWeightMg: BigInt(body.stoneWeightMg),
            otherDeductionWeightMg: BigInt(body.otherDeductionWeightMg),
            purchaseKarat: body.purchaseKarat,
            quoteId: body.quoteId,
            paidRial: BigInt(body.paidRial),
            effectiveAt: new Date(body.effectiveAt),
            createdBy: auth.sub,
          });

          return {
            status: HttpStatus.CREATED,
            body: {
              secondHandPurchaseId: created.secondHandPurchaseId,
              ledgerTransactionId: created.ledgerTransactionId,
              inventoryMovementId: created.inventoryMovementId,
              sourceInvoiceId: created.sourceInvoiceId,
              pureWeightMg: created.pureWeightMg.toString(),
              goldRatePerGramRial: created.goldRatePerGramRial.toString(),
              paidRial: created.paidRial.toString(),
              payableRial: created.payableRial.toString(),
              breakdown: {
                originalPurchaseAmountRial: created.originalPurchaseAmountRial.toString(),
                todayPurchaseAmountRial: created.todayPurchaseAmountRial.toString(),
                differenceRial: created.breakdown.differenceRial.toString(),
                wageBurnedRial: created.breakdown.wageBurnedRial.toString(),
                karatDifferenceRial: created.breakdown.karatDifferenceRial.toString(),
                marketPriceDifferenceRial: created.breakdown.marketPriceDifferenceRial.toString(),
                otherCalculationDifferenceRial:
                  created.breakdown.otherCalculationDifferenceRial.toString(),
              },
            },
          };
        },
      });

      return result.response.body;
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) throw new ConflictException(error.message);
      if (
        error instanceof B2cBuybackInvoiceNotFoundError ||
        error instanceof B2cBuybackPartyNotAvailableError
      ) {
        throw new NotFoundException(error.message);
      }
      if (
        error instanceof B2cBuybackInvoiceNotFinalizedError ||
        error instanceof B2cBuybackPartyNotConsumerError ||
        error instanceof B2cBuybackSourceItemsUnsupportedError ||
        error instanceof B2cBuybackSourceSnapshotInvalidError ||
        error instanceof B2cBuybackSourceSnapshotMismatchError ||
        error instanceof SecondHandPurchaseQuoteNotFoundError ||
        error instanceof SecondHandPurchasePricingSettingInvalidError ||
        error instanceof SecondHandPurchaseCalculationError ||
        error instanceof SecondHandPurchasePaidRialExceedsAmountError
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
