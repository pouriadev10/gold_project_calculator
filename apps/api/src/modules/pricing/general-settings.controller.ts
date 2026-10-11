import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { updateGeneralSettingSchema } from '@gold/contracts';
import { CurrentAuth } from '../../platform/auth/current-user.decorator';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { IDEMPOTENCY_KEY_HEADER } from '../../platform/idempotency/idempotency-key';
import { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import { GeneralSettingsService } from './general-settings.service';
import { InvalidSettingVersionDateError, SettingVersionConflictError } from './versioned-settings.errors';
import type { GeneralSetting, GeneralSettings, UpdateGeneralSettingInput } from '@gold/contracts';
import type { AccessTokenPayload } from '../../platform/auth/token.service';

/**
 * تنظیمات عمومی مستأجر — FE-080.
 *
 * خواندن برای هر سه نقش باز است (صندوقدار هم باید بداند پنجره‌ی اصلاح چند
 * دقیقه است)؛ تغییر فقط OWNER و MANAGER، با `Idempotency-Key` اجباری. هر
 * تغییر یک نسخه‌ی تازه با شروع اعتبار «اکنون» می‌سازد.
 */
@Controller('settings/general')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GeneralSettingsController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(GeneralSettingsService) private readonly settings: GeneralSettingsService,
  ) {}

  @Get()
  @Roles('OWNER', 'MANAGER', 'CASHIER')
  async list(): Promise<GeneralSettings> {
    return this.settings.list(this.context.getTenantId());
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('OWNER', 'MANAGER')
  async update(
    @Body(new ZodValidationPipe(updateGeneralSettingSchema)) body: UpdateGeneralSettingInput,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<GeneralSetting> {
    if (auth === undefined) throw new UnauthorizedException();

    const tenantId = this.context.getTenantId();
    try {
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: { method: 'POST', path: '/settings/general', body },
        execute: async (transaction) => ({
          status: HttpStatus.CREATED,
          body: await this.settings.updateInTransaction(transaction, {
            tenantId,
            key: body.key,
            value: body.value,
            createdBy: auth.sub,
          }),
        }),
      });
      return result.response.body;
    } catch (error) {
      if (
        error instanceof IdempotencyKeyConflictError ||
        error instanceof SettingVersionConflictError ||
        // دو تغییر در یک لحظه برای یک کلید: نسخه‌ی دوم شروع اعتبار تازه‌تری ندارد.
        error instanceof InvalidSettingVersionDateError
      ) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }
}
