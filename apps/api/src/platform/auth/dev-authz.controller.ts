import { Controller, Get, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import { RequestContextService } from '../request-context/request-context.service';
import { CurrentAuth } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import type { AccessTokenPayload } from './token.service';

interface AuthzProbeResponse {
  readonly userId: string;
  readonly tenantId: string;
}

/**
 * مسیرهای کارآزمایی مجوزدهی — **فقط خارج از production**.
 *
 * تنظیمات واقعی نسخه‌دار در BE-018 و BE-019 می‌آیند؛ تا آن روز معیار
 * پذیرش BE-012 («CASHIER نتواند تنظیمات حساس را تغییر دهد») به مسیری
 * نیاز دارد که واقعاً محافظت شده باشد. اینجا همان است: نگهبان‌ها همان
 * نگهبان‌های production هستند، فقط چیزی که محافظت می‌کنند ساختگی است.
 *
 * ترتیب نگهبان‌ها معنادار است: اول احراز هویت، بعد مجوزدهی.
 */
@Controller('internal/dev/authz')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DevAuthzController {
  constructor(@Inject(RequestContextService) private readonly context: RequestContextService) {}

  /** هر عضو این مستأجر — بدون `@Roles`. */
  @Get('whoami')
  whoami(@CurrentAuth() auth: AccessTokenPayload | undefined): AuthzProbeResponse {
    return { userId: auth?.sub ?? '', tenantId: this.context.getTenantId() };
  }

  /** «تنظیمات حساس» — صندوق‌دار نباید بتواند. */
  @Post('sensitive-setting')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER', 'MANAGER')
  changeSensitiveSetting(@CurrentAuth() auth: AccessTokenPayload | undefined): AuthzProbeResponse {
    return { userId: auth?.sub ?? '', tenantId: this.context.getTenantId() };
  }

  /** فقط مالک — برای اثبات اینکه فهرست سفید است، نه «این نقش و بالاتر». */
  @Post('owner-only')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER')
  ownerOnly(@CurrentAuth() auth: AccessTokenPayload | undefined): AuthzProbeResponse {
    return { userId: auth?.sub ?? '', tenantId: this.context.getTenantId() };
  }
}
