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
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  createJewelryItemSchema,
  jewelryItemDetailQuerySchema,
  jewelryItemQuerySchema,
  updateJewelryItemSchema,
} from '@gold/contracts';
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
  InactiveJewelryItemError,
  InvalidJewelryItemVersionDateError,
  InvalidJewelryKaratError,
  InvalidJewelryWeightError,
  JewelryDeductionExceedsGrossError,
  JewelryItemCodeConflictError,
  JewelryItemNotFoundError,
  JewelryItemVersionConflictError,
} from './jewelry-items.errors';
import { JewelryItemsService } from './jewelry-items.service';
import type {
  CreateJewelryItemInput as CreateJewelryItemBody,
  JewelryItemDetailQuery,
  JewelryItemList,
  JewelryItemQuery,
  JewelryItemVersion as JewelryItemVersionResponse,
  UpdateJewelryItemInput as UpdateJewelryItemBody,
} from '@gold/contracts';
import type { AccessTokenPayload } from '../../platform/auth/token.service';
import type { JewelryItemDetail } from './jewelry-items.service';

const BASE_PATH = '/inventory/jewelry-items';

/**
 * نگاشت خطای دامنه به HTTP.
 *
 * ۴۰۰ برای ورودی‌ای که به‌تنهایی غلط است و ۴۰۹ برای ورودی‌ای که با
 * **وضعیت فعلی** داده‌ها نمی‌خواند — تاریخ نسخه، کد تکراری، کالای
 * غیرفعال. کلاینت از روی همین تفاوت می‌فهمد که آیا اصلاح ورودی کمک
 * می‌کند یا باید وضعیت را دوباره بخواند.
 */
function mapDomainError(error: unknown): never {
  if (error instanceof JewelryItemNotFoundError) {
    throw new NotFoundException(error.message);
  }
  if (
    error instanceof JewelryItemCodeConflictError ||
    error instanceof InvalidJewelryItemVersionDateError ||
    error instanceof JewelryItemVersionConflictError ||
    error instanceof InactiveJewelryItemError ||
    error instanceof IdempotencyKeyConflictError
  ) {
    throw new ConflictException(error.message);
  }
  if (
    error instanceof InvalidJewelryKaratError ||
    error instanceof InvalidJewelryWeightError ||
    error instanceof JewelryDeductionExceedsGrossError
  ) {
    throw new BadRequestException(error.message);
  }

  throw error;
}

/**
 * شکل پاسخ صریح نوشته شده است تا ستون جدیدِ جدول ناخواسته درز نکند.
 *
 * وزن خالص عمداً نیست: مشتق وزن ناخالص، کسورات و عیار است و
 * `articlePureMg` مالکش — همان تصمیم BE-025 در سطح قرارداد.
 */
function toResponse(detail: JewelryItemDetail): JewelryItemVersionResponse {
  const { version } = detail;

  return {
    id: version.id,
    jewelryItemId: version.jewelryItemId,
    code: detail.code,
    title: version.title,
    grossWeightMg: version.grossWeightMg.toString(),
    karat: version.karat,
    stoneWeightMg: version.stoneWeightMg.toString(),
    otherDeductionWeightMg: version.otherDeductionWeightMg.toString(),
    wageType: version.wageType,
    wageValue: version.wageValue.toString(),
    validFrom: version.validFrom.toISOString(),
    validTo: version.validTo?.toISOString() ?? null,
    version: version.version,
    active: version.active,
  };
}

/** کاتالوگ کالای زیورآلات — BE-026. */
@Controller('inventory/jewelry-items')
@UseGuards(JwtAuthGuard, RolesGuard)
export class JewelryItemsController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(JewelryItemsService) private readonly items: JewelryItemsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('OWNER', 'MANAGER')
  async create(
    @Body(new ZodValidationPipe(createJewelryItemSchema)) body: CreateJewelryItemBody,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<JewelryItemVersionResponse> {
    if (auth === undefined) {
      throw new UnauthorizedException();
    }

    const tenantId = this.context.getTenantId();

    try {
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: { method: 'POST', path: BASE_PATH, body },
        execute: async (transaction) => {
          const version = await this.items.createItemInTransaction(transaction, {
            tenantId,
            code: body.code,
            title: body.title,
            grossWeightMg: BigInt(body.grossWeightMg),
            karat: body.karat,
            stoneWeightMg: BigInt(body.stoneWeightMg),
            otherDeductionWeightMg: BigInt(body.otherDeductionWeightMg),
            wageType: body.wageType,
            wageValue: BigInt(body.wageValue),
            validFrom: body.validFrom === undefined ? new Date() : new Date(body.validFrom),
            active: true,
            actorUserId: auth.sub,
          });

          return {
            status: HttpStatus.CREATED,
            body: toResponse({ code: body.code, version }),
          };
        },
      });

      return result.response.body;
    } catch (error) {
      return mapDomainError(error);
    }
  }

  @Get()
  async list(
    @Query(new ZodValidationPipe(jewelryItemQuerySchema)) query: JewelryItemQuery,
  ): Promise<JewelryItemList> {
    const page = await this.items.list(this.context.getTenantId(), {
      search: query.search,
      active: query.active,
      limit: query.limit,
      offset: query.offset,
    });

    return {
      items: page.items.map(toResponse),
      total: page.total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  /**
   * پیش‌فرض، نسخه‌ی باز کالاست — «کالا همان‌طور که امروز هست».
   *
   * با `?at=` نسخه‌ی مؤثر در آن لحظه برمی‌گردد؛ همان چیزی که فاکتور آن روز
   * دیده است (قاعده‌ی ۲-۶).
   */
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(jewelryItemDetailQuerySchema)) query: JewelryItemDetailQuery,
  ): Promise<JewelryItemVersionResponse> {
    const tenantId = this.context.getTenantId();

    try {
      const detail =
        query.at === undefined
          ? await this.items.getLatest(tenantId, id)
          : await this.items.getEffectiveDetail(tenantId, id, new Date(query.at));

      return toResponse(detail);
    } catch (error) {
      return mapDomainError(error);
    }
  }

  @Patch(':id')
  @Roles('OWNER', 'MANAGER')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateJewelryItemSchema)) body: UpdateJewelryItemBody,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<JewelryItemVersionResponse> {
    if (auth === undefined) {
      throw new UnauthorizedException();
    }

    const tenantId = this.context.getTenantId();

    try {
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: { method: 'PATCH', path: `${BASE_PATH}/${id}`, body },
        execute: async (transaction) => {
          const detail = await this.items.updateInTransaction(transaction, {
            tenantId,
            jewelryItemId: id,
            title: body.title,
            grossWeightMg:
              body.grossWeightMg === undefined ? undefined : BigInt(body.grossWeightMg),
            karat: body.karat,
            stoneWeightMg:
              body.stoneWeightMg === undefined ? undefined : BigInt(body.stoneWeightMg),
            otherDeductionWeightMg:
              body.otherDeductionWeightMg === undefined
                ? undefined
                : BigInt(body.otherDeductionWeightMg),
            wageType: body.wageType,
            wageValue: body.wageValue === undefined ? undefined : BigInt(body.wageValue),
            validFrom: body.validFrom === undefined ? undefined : new Date(body.validFrom),
            actorUserId: auth.sub,
          });

          return { status: HttpStatus.OK, body: toResponse(detail) };
        },
      });

      return result.response.body;
    } catch (error) {
      return mapDomainError(error);
    }
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER', 'MANAGER')
  async deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<JewelryItemVersionResponse> {
    if (auth === undefined) {
      throw new UnauthorizedException();
    }

    const tenantId = this.context.getTenantId();

    try {
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: { method: 'POST', path: `${BASE_PATH}/${id}/deactivate`, body: {} },
        execute: async (transaction) => {
          const detail = await this.items.deactivateInTransaction(transaction, {
            tenantId,
            jewelryItemId: id,
            actorUserId: auth.sub,
          });

          return { status: HttpStatus.OK, body: toResponse(detail) };
        },
      });

      return result.response.body;
    } catch (error) {
      return mapDomainError(error);
    }
  }
}
