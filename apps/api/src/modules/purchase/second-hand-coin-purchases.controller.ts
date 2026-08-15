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
import { createSecondHandCoinPurchaseSchema } from '@gold/contracts';
import { CurrentAuth } from '../../platform/auth/current-user.decorator';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { IDEMPOTENCY_KEY_HEADER } from '../../platform/idempotency/idempotency-key';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import { CoinTypeNotFoundError, InactiveCoinTypeError } from '../inventory/coin-types.errors';
import {
  SecondHandCoinPurchaseInvalidInputError,
  SecondHandPurchasePaidRialExceedsAmountError,
  SecondHandPurchasePartyNotConsumerError,
  SecondHandPurchasePartyNotFoundError,
  SecondHandPurchasePricingSettingInvalidError,
  SecondHandPurchaseQuoteNotFoundError,
} from './second-hand-gold-purchases.errors';
import { SecondHandCoinPurchasesService } from './second-hand-coin-purchases.service';
import type { CreateSecondHandCoinPurchaseInput, SecondHandCoinPurchase } from '@gold/contracts';
import type { AccessTokenPayload } from '../../platform/auth/token.service';

const PATH = '/purchase/second-hand/coins';

@Controller('purchase/second-hand')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class SecondHandCoinPurchasesController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(SecondHandCoinPurchasesService)
    private readonly purchases: SecondHandCoinPurchasesService,
  ) {}

  @Post('coins')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(createSecondHandCoinPurchaseSchema))
    body: CreateSecondHandCoinPurchaseInput,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<SecondHandCoinPurchase> {
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
            coinTypeId: body.coinTypeId,
            count: body.count,
            purchaseUnitPriceRial: BigInt(body.purchaseUnitPriceRial),
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
              coinTypeId: created.coinTypeId,
              count: created.count,
              purchaseUnitPriceRial: created.purchaseUnitPriceRial.toString(),
              purchaseAmountRial: created.purchaseAmountRial.toString(),
              paidRial: created.paidRial.toString(),
              payableRial: created.payableRial.toString(),
              intrinsicValueRial: created.intrinsicValueRial.toString(),
              bubbleRial: created.bubbleRial === null ? null : created.bubbleRial.toString(),
            },
          };
        },
      });

      return result.response.body;
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) throw new ConflictException(error.message);
      if (
        error instanceof SecondHandPurchasePartyNotFoundError ||
        error instanceof CoinTypeNotFoundError
      ) {
        throw new NotFoundException(error.message);
      }
      if (
        error instanceof SecondHandPurchasePartyNotConsumerError ||
        error instanceof SecondHandPurchaseQuoteNotFoundError ||
        error instanceof SecondHandPurchasePricingSettingInvalidError ||
        error instanceof SecondHandPurchasePaidRialExceedsAmountError ||
        error instanceof SecondHandCoinPurchaseInvalidInputError ||
        error instanceof InactiveCoinTypeError
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
