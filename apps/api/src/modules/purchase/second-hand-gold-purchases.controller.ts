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
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { createSecondHandGoldPurchaseSchema } from '@gold/contracts';
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
  SecondHandPurchaseCalculationError,
  SecondHandPurchasePaidRialExceedsAmountError,
  SecondHandPurchasePartyNotConsumerError,
  SecondHandPurchasePartyNotFoundError,
  SecondHandPurchasePricingSettingInvalidError,
  SecondHandPurchaseQuoteNotFoundError,
} from './second-hand-gold-purchases.errors';
import { SecondHandGoldPurchasesService } from './second-hand-gold-purchases.service';
import type { CreateSecondHandGoldPurchaseInput, SecondHandGoldPurchase } from '@gold/contracts';
import type { AccessTokenPayload } from '../../platform/auth/token.service';

const PATH = '/purchase/second-hand/gold';

@Controller('purchase/second-hand')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class SecondHandGoldPurchasesController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(SecondHandGoldPurchasesService)
    private readonly purchases: SecondHandGoldPurchasesService,
  ) {}

  @Post('gold')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(createSecondHandGoldPurchaseSchema))
    body: CreateSecondHandGoldPurchaseInput,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<SecondHandGoldPurchase> {
    if (auth === undefined) throw new UnauthorizedException();

    try {
      const tenantId = this.context.getTenantId();
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: { method: 'POST', path: PATH, body },
        execute: async (transaction) => {
          const created = await this.purchases.createInTransaction(transaction, {
            tenantId,
            partyId: body.partyId,
            grossWeightMg: BigInt(body.grossWeightMg),
            stoneWeightMg: BigInt(body.stoneWeightMg),
            otherDeductionWeightMg: BigInt(body.otherDeductionWeightMg),
            purchaseKarat: body.purchaseKarat,
            quoteId: body.quoteId,
            feeRial: BigInt(body.feeRial),
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
              pureWeightMg: created.pureWeightMg.toString(),
              goldRatePerGramRial: created.goldRatePerGramRial.toString(),
              grossPurchaseAmountRial: created.grossPurchaseAmountRial.toString(),
              feeRial: created.feeRial.toString(),
              finalAmountRial: created.finalAmountRial.toString(),
              paidRial: created.paidRial.toString(),
              payableRial: created.payableRial.toString(),
            },
          };
        },
      });

      return result.response.body;
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) throw new ConflictException(error.message);
      if (error instanceof SecondHandPurchasePartyNotFoundError)
        throw new NotFoundException(error.message);
      if (
        error instanceof SecondHandPurchasePartyNotConsumerError ||
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
