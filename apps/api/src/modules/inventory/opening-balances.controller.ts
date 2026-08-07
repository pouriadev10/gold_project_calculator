import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { createOpeningBalanceSchema, inventoryItemTypeSchema } from '@gold/contracts';
import { CurrentAuth } from '../../platform/auth/current-user.decorator';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { IDEMPOTENCY_KEY_HEADER } from '../../platform/idempotency/idempotency-key';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import { InactiveJewelryItemError, JewelryItemNotFoundError } from './jewelry-items.errors';
import {
  OpeningBalanceCoinTypeUnavailableError,
  OpeningBalanceJewelryPureWeightZeroError,
} from './opening-balances.errors';
import { OpeningBalancesService } from './opening-balances.service';
import { InventoryMovementsService } from './inventory-movements.service';
import type {
  CreateOpeningBalanceInput as CreateOpeningBalanceBody,
  InventoryBalances,
  InventoryItemType,
  OpeningBalance as OpeningBalanceResponse,
} from '@gold/contracts';
import type { AccessTokenPayload } from '../../platform/auth/token.service';
import type { CreatedOpeningBalance } from './opening-balances.service';

const OPENING_BALANCES_PATH = '/inventory/opening-balances';

function toOpeningBalanceResponse(result: CreatedOpeningBalance): OpeningBalanceResponse {
  return {
    id: result.openingBalance.id,
    ledgerTransactionId: result.ledgerTransactionId,
    effectiveAt: result.openingBalance.effectiveAt.toISOString(),
    description: result.openingBalance.description,
    createdAt: result.openingBalance.createdAt.toISOString(),
  };
}

/**
 * Tenant startup inventory. The write endpoint passes the idempotency-owned
 * PostgreSQL transaction all the way into the opening and posting services.
 */
@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER')
export class OpeningBalancesController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(InventoryMovementsService) private readonly movements: InventoryMovementsService,
    @Inject(OpeningBalancesService) private readonly openingBalances: OpeningBalancesService,
  ) {}

  @Post('opening-balances')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(createOpeningBalanceSchema)) body: CreateOpeningBalanceBody,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<OpeningBalanceResponse> {
    if (auth === undefined) {
      throw new UnauthorizedException();
    }

    const tenantId = this.context.getTenantId();
    try {
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: { method: 'POST', path: OPENING_BALANCES_PATH, body },
        execute: async (transaction) => {
          const openingBalance = await this.openingBalances.createInTransaction(transaction, {
            tenantId,
            effectiveAt: new Date(body.effectiveAt),
            description: body.description,
            lines: body.lines.map((line) => ({ ...line, quantity: BigInt(line.quantity) })),
            createdBy: auth.sub,
          });

          return {
            status: HttpStatus.CREATED,
            body: toOpeningBalanceResponse(openingBalance),
          };
        },
      });

      return result.response.body;
    } catch (error) {
      return this.rethrowKnownError(error);
    }
  }

  @Get('balances')
  async balances(
    @Query('itemType', new ZodValidationPipe(inventoryItemTypeSchema.optional()))
    itemType: InventoryItemType | undefined,
  ): Promise<InventoryBalances> {
    const balances = await this.movements.balances(this.context.getTenantId(), itemType);

    return balances.map((balance) => ({
      itemType: balance.itemType,
      itemId: balance.itemId,
      quantity: balance.quantity.toString(),
    }));
  }

  private rethrowKnownError(error: unknown): never {
    if (error instanceof IdempotencyKeyConflictError) {
      throw new ConflictException(error.message);
    }
    if (error instanceof JewelryItemNotFoundError) {
      throw new NotFoundException(error.message);
    }
    if (
      error instanceof InactiveJewelryItemError ||
      error instanceof OpeningBalanceCoinTypeUnavailableError ||
      error instanceof OpeningBalanceJewelryPureWeightZeroError
    ) {
      throw new ConflictException(error.message);
    }

    throw error;
  }
}
