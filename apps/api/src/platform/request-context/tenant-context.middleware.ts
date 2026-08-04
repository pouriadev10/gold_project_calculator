import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { TenantService } from '../tenant/tenant.service';
import { isTenantWritable } from '../tenant/tenant.rules';
import {
  InvalidIdempotencyKeyError,
  MissingIdempotencyKeyError,
} from '../idempotency/idempotency.errors';
import { readIdempotencyKey, requireIdempotencyKey } from '../idempotency/idempotency-key';
import { RequestContextService } from './request-context.service';
import { TENANT_HEADER } from './request-context.errors';
import { isPublicPath, resolveRequestPath } from './request-path';
import type { MountedRequest } from './request-path';

/** متدهایی که مستأجر معلق حق انجامشان را ندارد — قاعده‌ی BE-007. */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** UUID با هر نسخه‌ای — همان چیزی که ستون `tenants.id` تولید می‌کند. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readTenantHeader(req: MountedRequest): string | undefined {
  const value = req.headers[TENANT_HEADER];

  // Node هدر تکراری را آرایه می‌کند. دو مستأجر متفاوت در یک درخواست
  // ابهام است، نه چیزی که بشود یکی‌اش را انتخاب کرد.
  if (Array.isArray(value)) {
    return undefined;
  }

  const trimmed = value?.trim();

  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/**
 * مستأجر جاری را از هدر می‌خواند، اعتبارسنجی می‌کند و بقیه‌ی درخواست را
 * داخل context اجرا می‌کند — BE-008.
 *
 * میان‌افزار است نه Guard یا Interceptor، چون تنها لایه‌ای است که هم
 * **پیش از** همه چیز اجرا می‌شود و هم می‌تواند ادامه‌ی زنجیره را داخل
 * `AsyncLocalStorage.run()` بپیچد. Guard فقط بله/خیر برمی‌گرداند و
 * Interceptor بعد از Guardها اجرا می‌شود — یعنی Guard مجوزدهی BE-012
 * نمی‌توانست مستأجر را ببیند.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(TenantService) private readonly tenants: TenantService,
  ) {}

  async use(
    req: MountedRequest,
    _res: ServerResponse,
    next: (error?: unknown) => void,
  ): Promise<void> {
    if (isPublicPath(resolveRequestPath(req))) {
      next();
      return;
    }

    const tenantId = readTenantHeader(req);

    if (tenantId === undefined) {
      throw new BadRequestException(`هدر ${TENANT_HEADER} الزامی است`);
    }

    if (!UUID_PATTERN.test(tenantId)) {
      throw new BadRequestException(`هدر ${TENANT_HEADER} باید UUID معتبر باشد`);
    }

    const tenant = await this.tenants.findById(tenantId);

    if (tenant === undefined) {
      throw new NotFoundException('مستأجر پیدا نشد');
    }

    /*
     * مستأجر معلق می‌تواند بخواند ولی نمی‌تواند بنویسد — قاعده‌ی BE-007.
     * منطقش در `tenant.rules.ts` است تا هر مصرف‌کننده‌ای همان یک تعریف را
     * ببیند، نه نسخه‌ی دست‌ساز خودش.
     */
    if (WRITE_METHODS.has(req.method ?? '') && !isTenantWritable(tenant)) {
      throw new ForbiddenException('مستأجر غیرفعال است و اجازه‌ی عملیات نوشتنی ندارد');
    }

    /*
     * `next()` داخل `run` صدا زده می‌شود، پس کل ادامه‌ی زنجیره — Guardها،
     * Interceptorها، Pipeها و خود handler — داخل همین context اجرا می‌شوند
     * و هر `await` میانی هم آن را حفظ می‌کند.
     */
    if (WRITE_METHODS.has(req.method ?? '')) {
      try {
        requireIdempotencyKey(readIdempotencyKey(req.headers));
      } catch (error) {
        if (
          error instanceof InvalidIdempotencyKeyError ||
          error instanceof MissingIdempotencyKeyError
        ) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }
    }

    this.context.run({ tenantId: tenant.id, tenantSlug: tenant.slug, userId: undefined }, () => {
      next();
    });
  }
}
