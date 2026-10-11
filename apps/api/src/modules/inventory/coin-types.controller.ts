import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { createCoinTypeSchema, createCoinTypeVersionSchema } from '@gold/contracts';
import { CurrentAuth } from '../../platform/auth/current-user.decorator';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { IDEMPOTENCY_KEY_HEADER } from '../../platform/idempotency/idempotency-key';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import {
  CoinMintTypeMismatchError,
  CoinTypeCodeConflictError,
  CoinTypeNotFoundError,
  CoinTypeVersionConflictError,
  InvalidCoinTypeVersionDateError,
} from './coin-types.errors';
import { CoinTypesService } from './coin-types.service';
import type {
  CoinTypeCatalog,
  CoinTypeVersion as CoinTypeVersionResponse,
  CreateCoinTypeInput as CreateCoinTypeBody,
  CreateCoinTypeVersionInput as CreateCoinTypeVersionBody,
} from '@gold/contracts';
import type { AccessTokenPayload } from '../../platform/auth/token.service';
import type { CoinTypeVersion } from '../../platform/database/schema';

const BASE_PATH = '/inventory/coin-types';

/**
 * نگاشت خطای دامنه به HTTP — همان قرارداد `JewelryItemsController`:
 * ۴۰۴ نوع ناموجود (یا متعلق به مستأجر دیگر)، ۴۰۹ ورودی‌ای که با وضعیت
 * فعلی نمی‌خواند (کد تکراری، نسخه‌ی هم‌زمان، تاریخ)، ۴۰۰ ورودی ذاتاً غلط.
 */
function mapDomainError(error: unknown): never {
  if (error instanceof CoinTypeNotFoundError) {
    throw new NotFoundException(error.message);
  }
  if (
    error instanceof CoinTypeCodeConflictError ||
    error instanceof CoinTypeVersionConflictError ||
    // دو نسخه در یک لحظه: نسخه‌ی دوم شروع اعتبار تازه‌تری از نسخه‌ی باز ندارد.
    error instanceof InvalidCoinTypeVersionDateError ||
    error instanceof IdempotencyKeyConflictError
  ) {
    throw new ConflictException(error.message);
  }
  if (error instanceof CoinMintTypeMismatchError) {
    throw new BadRequestException(error.message);
  }

  throw error;
}

/** شکل پاسخ صریح — ستون تازه‌ی جدول ناخواسته درز نمی‌کند و وزن رشته‌ی میکروگرم می‌ماند. */
export function toCoinTypeVersionResponse(code: string, version: CoinTypeVersion): CoinTypeVersionResponse {
  const shared = {
    id: version.id,
    coinTypeId: version.coinTypeId,
    code,
    title: version.title,
    grossWeightUg: version.grossWeightUg.toString(),
    karat: version.karat,
    validFrom: version.validFrom.toISOString(),
    validTo: version.validTo?.toISOString() ?? null,
    version: version.version,
    active: version.active,
  };

  // دو شاخه‌ی لیترال تا union قرارداد واقعاً narrow شود (قاعده‌ی حباب ۲-۳).
  if (version.mintType === 'CENTRAL_BANK') {
    return { ...shared, mintType: 'CENTRAL_BANK', isCentralBankMinted: true };
  }
  return { ...shared, mintType: version.mintType, isCentralBankMinted: false };
}

/**
 * انواع سکه — FE-081 (و خواندن FE-038 به بعد).
 *
 * خواندن برای هر سه نقش باز است، چون فروش، خرید و تسویه‌ی سکه فهرست انواع
 * را لازم دارند؛ ساختن نوع یا نسخه‌ی تازه فقط OWNER و MANAGER، با
 * `Idempotency-Key` اجباری. هر تغییر نسخه‌ی تازه‌ای از «اکنون» می‌سازد و
 * نسخه‌ی قبلی بسته می‌شود؛ سندهای گذشته به نسخه‌ی زمان خودشان اشاره دارند.
 */
@Controller('inventory/coin-types')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CoinTypesController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(CoinTypesService) private readonly coinTypes: CoinTypesService,
  ) {}

  /** نسخه‌ی مؤثر همین لحظه‌ی هر نوع — فعال و غیرفعال؛ فرم‌ها خودشان فعال‌ها را جدا می‌کنند. */
  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  async list(): Promise<CoinTypeVersionResponse[]> {
    const rows = await this.coinTypes.listEffective(this.context.getTenantId(), new Date());
    return rows.map((row) => toCoinTypeVersionResponse(row.code, row.version));
  }

  /** همه‌ی انواع با تاریخچه‌ی کامل نسخه‌ها، تازه‌ترین اول — صفحه‌ی تنظیمات. */
  @Get('history')
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  async history(): Promise<CoinTypeCatalog> {
    const types = await this.coinTypes.listHistory(this.context.getTenantId());
    return {
      types: types.map((type) => ({
        coinTypeId: type.coinTypeId,
        code: type.code,
        versions: type.versions.map((version) => toCoinTypeVersionResponse(type.code, version)),
      })),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('OWNER', 'MANAGER')
  async create(
    @Body(new ZodValidationPipe(createCoinTypeSchema)) body: CreateCoinTypeBody,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<CoinTypeVersionResponse> {
    if (auth === undefined) throw new UnauthorizedException();

    const tenantId = this.context.getTenantId();
    try {
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: { method: 'POST', path: BASE_PATH, body },
        execute: async (transaction) => {
          const version = await this.coinTypes.createTypeInTransaction(transaction, {
            tenantId,
            code: body.code,
            title: body.title,
            mintType: body.mintType,
            grossWeightUg: BigInt(body.grossWeightUg),
            karat: body.karat,
            isCentralBankMinted: body.mintType === 'CENTRAL_BANK',
            validFrom: new Date(),
            active: body.active,
            actorUserId: auth.sub,
          });
          const code = await this.coinTypes.getCodeInTransaction(transaction, tenantId, version.coinTypeId);
          return { status: HttpStatus.CREATED, body: toCoinTypeVersionResponse(code, version) };
        },
      });
      return result.response.body;
    } catch (error) {
      return mapDomainError(error);
    }
  }

  @Post(':coinTypeId/versions')
  @HttpCode(HttpStatus.CREATED)
  @Roles('OWNER', 'MANAGER')
  async createVersion(
    @Param('coinTypeId', ParseUUIDPipe) coinTypeId: string,
    @Body(new ZodValidationPipe(createCoinTypeVersionSchema)) body: CreateCoinTypeVersionBody,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<CoinTypeVersionResponse> {
    if (auth === undefined) throw new UnauthorizedException();

    const tenantId = this.context.getTenantId();
    try {
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: { method: 'POST', path: `${BASE_PATH}/${coinTypeId}/versions`, body },
        execute: async (transaction) => {
          const version = await this.coinTypes.createVersionInTransaction(transaction, {
            tenantId,
            coinTypeId,
            title: body.title,
            mintType: body.mintType,
            grossWeightUg: BigInt(body.grossWeightUg),
            karat: body.karat,
            isCentralBankMinted: body.mintType === 'CENTRAL_BANK',
            validFrom: new Date(),
            active: body.active,
            actorUserId: auth.sub,
          });
          const code = await this.coinTypes.getCodeInTransaction(transaction, tenantId, coinTypeId);
          return { status: HttpStatus.CREATED, body: toCoinTypeVersionResponse(code, version) };
        },
      });
      return result.response.body;
    } catch (error) {
      return mapDomainError(error);
    }
  }
}
