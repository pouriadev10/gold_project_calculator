import { Controller, Get, Inject } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service';
import { RequestContextService } from './request-context.service';

interface ContextResponse {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly userId: string | null;
  /** slug خوانده‌شده از دیتابیس **پس از** یک مرز async. */
  readonly slugAfterAwait: string | null;
}

/**
 * آینه‌ی context جاری — **فقط خارج از production**.
 *
 * بدون این، معیار «دو درخواست هم‌زمان context یکدیگر را نبینند» فقط
 * روی خودِ سرویس قابل تست بود، نه از مسیر واقعی HTTP با میان‌افزار،
 * Guardها و مسیریابی Fastify در میان. اینجا همان مسیری آزموده می‌شود
 * که یک endpoint واقعی طی می‌کند.
 */
@Controller('internal/dev/context')
export class DevContextController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(TenantService) private readonly tenants: TenantService,
  ) {}

  @Get()
  async current(): Promise<ContextResponse> {
    const tenantIdBefore = this.context.getTenantId();

    /*
     * یک رفت‌وبرگشت واقعی به دیتابیس، عمداً بین دو خواندن context.
     * اگر `AsyncLocalStorage` از مرز async رد نشود یا بین درخواست‌ها نشت
     * کند، مقدارِ بعد از این خط با مقدارِ قبلش فرق می‌کند.
     */
    const tenant = await this.tenants.findById(tenantIdBefore);

    return {
      tenantId: this.context.getTenantId(),
      tenantSlug: this.context.getTenantSlug(),
      userId: this.context.getUserId() ?? null,
      slugAfterAwait: tenant?.slug ?? null,
    };
  }
}
