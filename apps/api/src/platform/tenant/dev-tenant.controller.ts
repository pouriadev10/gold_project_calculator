import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../shared/validation';
import { createTenantSchema } from './tenant.dto';
import { TenantSlugConflictError } from './tenant.errors';
import { TenantService } from './tenant.service';
import type { CreateTenantInput } from './tenant.dto';
import type { Tenant } from '../database/schema';

/** شکل پاسخ — صریح نوشته شده تا اضافه‌شدن ستون به جدول ناخواسته درز نکند. */
interface TenantResponse {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: Tenant['status'];
  readonly timezone: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toResponse(tenant: Tenant): TenantResponse {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    timezone: tenant.timezone,
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
  };
}

/**
 * endpointهای موقت راه‌اندازی مستأجر — **فقط خارج از production**.
 *
 * ثبت‌نام واقعی مستأجر بعداً از مسیر احراز هویت‌شده می‌آید. تا آن روز
 * تیم برای کار کردن روی بقیه‌ی تسک‌ها به یک راه ساخت مستأجر نیاز دارد.
 *
 * این کلاس اصلاً در production نمونه‌سازی نمی‌شود — `TenantModule.register()`
 * آن را از فهرست controllerها حذف می‌کند، پس مسیر در جدول مسیریابی
 * Fastify وجود ندارد و نتیجه ۴۰۴ است، نه یک نگهبان که ممکن است دور زده شود.
 */
@Controller('internal/dev/tenants')
export class DevTenantController {
  /*
   * `@Inject` صریح است، هرچند Nest می‌تواند نوع را از متادیتای دکوراتور
   * حدس بزند. دلیلش یک تله‌ی واقعی است: با تزریق ضمنی، `TenantService`
   * فقط در جایگاه **نوع** ظاهر می‌شود و قاعده‌ی `consistent-type-imports`
   * پیشنهاد `import type` می‌دهد — که مرجع را در خروجی پاک می‌کند،
   * `design:paramtypes` را خالی می‌گذارد و تزریق را بی‌صدا می‌شکند.
   * ارجاع صریح به کلاس، آن را به یک مقدار واقعی تبدیل می‌کند.
   */
  constructor(@Inject(TenantService) private readonly tenants: TenantService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(createTenantSchema)) body: CreateTenantInput,
  ): Promise<TenantResponse> {
    try {
      return toResponse(await this.tenants.create(body));
    } catch (error) {
      if (error instanceof TenantSlugConflictError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<TenantResponse> {
    const tenant = await this.tenants.findById(id);

    if (!tenant) {
      throw new NotFoundException('مستأجر پیدا نشد');
    }

    return toResponse(tenant);
  }
}
