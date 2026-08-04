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
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../shared/validation';
import { AuditService } from '../audit/audit.service';
import {
  IdempotencyKeyConflictError,
} from '../idempotency/idempotency.errors';
import { IDEMPOTENCY_KEY_HEADER } from '../idempotency/idempotency-key';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { RequestContextService } from '../request-context/request-context.service';
import { MembershipService } from '../users/membership.service';
import { MembershipNotFoundError } from '../users/user.errors';
import { changeMembershipRoleSchema } from '../users/user.dto';
import { CurrentAuth } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import type { ChangeMembershipRoleInput } from '../users/user.dto';
import type { AccessTokenPayload } from './token.service';

interface AuthzProbeResponse {
  readonly userId: string;
  readonly tenantId: string;
}

interface AuditHttpRequest {
  readonly ip: string;
  readonly headers: Record<string, readonly string[] | string | undefined>;
}

function auditRequestMetadata(request: AuditHttpRequest): {
  readonly ipAddress: string;
  readonly userAgent: string | null;
} {
  const userAgent = request.headers['user-agent'];

  return {
    ipAddress: request.ip,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
  };
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
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MembershipService) private readonly memberships: MembershipService,
  ) {}

  /** هر عضو این مستأجر — بدون `@Roles`. */
  @Get('whoami')
  whoami(@CurrentAuth() auth: AccessTokenPayload | undefined): AuthzProbeResponse {
    return { userId: auth?.sub ?? '', tenantId: this.context.getTenantId() };
  }

  /** «تنظیمات حساس» — صندوق‌دار نباید بتواند. */
  @Post('sensitive-setting')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER', 'MANAGER')
  async changeSensitiveSetting(
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
    @Req() request: AuditHttpRequest,
  ): Promise<AuthzProbeResponse> {
    if (auth === undefined) {
      throw new UnauthorizedException();
    }

    const tenantId = this.context.getTenantId();
    const response = { userId: auth.sub, tenantId };

    try {
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: {
          method: 'POST',
          path: '/internal/dev/authz/sensitive-setting',
          body: undefined,
        },
        execute: async (transaction) => {
          await this.audit.recordInTransaction(transaction, {
            tenantId,
            actorUserId: auth.sub,
            action: 'SETTINGS_CHANGED',
            entityType: 'tenant_settings',
            entityId: tenantId,
            metadata: { source: 'dev-authz' },
            ...auditRequestMetadata(request),
          });

          return { status: HttpStatus.OK, body: response };
        },
      });

      return result.response.body;
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  /** تغییر نقش آزمایشی، فقط برای پوشش واقعی audit و مجوزهای مدیریتی. */
  @Post('members/:userId/role')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER')
  async changeMemberRole(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(changeMembershipRoleSchema)) body: ChangeMembershipRoleInput,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<AuthzProbeResponse> {
    if (auth === undefined) {
      throw new UnauthorizedException();
    }

    const tenantId = this.context.getTenantId();
    const response = { userId: auth.sub, tenantId };

    try {
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: {
          method: 'POST',
          path: `/internal/dev/authz/members/${userId}/role`,
          body,
        },
        execute: async (transaction) => {
          await this.memberships.changeRoleInTransaction(
            transaction,
            tenantId,
            auth.sub,
            userId,
            body,
          );

          return { status: HttpStatus.OK, body: response };
        },
      });

      return result.response.body;
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof MembershipNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  /** فقط مالک — برای اثبات اینکه فهرست سفید است، نه «این نقش و بالاتر». */
  @Post('owner-only')
  @HttpCode(HttpStatus.OK)
  @Roles('OWNER')
  ownerOnly(@CurrentAuth() auth: AccessTokenPayload | undefined): AuthzProbeResponse {
    return { userId: auth?.sub ?? '', tenantId: this.context.getTenantId() };
  }
}
