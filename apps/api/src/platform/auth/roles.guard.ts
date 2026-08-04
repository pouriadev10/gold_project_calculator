import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { RequestContextService } from '../request-context/request-context.service';
import { MembershipService } from '../users/membership.service';
import { AUTH_PAYLOAD_KEY } from './auth.constants';
import { ROLES_METADATA_KEY } from './roles.decorator';
import type { AuthenticatedRequest } from './jwt-auth.guard';
import type { RoleCode } from '../database/schema';

/**
 * مجوزدهی نقش‌محور — BE-012.
 *
 * همیشه **بعد از** `JwtAuthGuard` می‌آید: آن می‌گوید «این درخواست از طرف
 * کیست»، این می‌گوید «اجازه دارد یا نه».
 *
 * ## چرا نقش از دیتابیس خوانده می‌شود و نه از توکن
 *
 * توکن دسترسی ادعای `role` را حمل می‌کند و خواندنش رایگان بود. ولی توکن
 * تا انقضایش (۱۵ دقیقه) قابل باطل کردن نیست، یعنی کسی که همین حالا از
 * مدیر به صندوق‌دار تنزل کرده — یا کلاً از مستأجر حذف شده — تا ربع ساعت
 * دسترسی قبلی‌اش را نگه می‌داشت. روی داده‌ی مالی، آن پنجره پذیرفتنی
 * نیست. هزینه‌اش یک کوئری ایندکس‌شده در هر درخواست محافظت‌شده است.
 *
 * ادعای `role` داخل توکن برای رابط کاربری می‌ماند (تا کلاینت بداند چه
 * دکمه‌هایی را نشان بدهد)، ولی سمت سرور مرجع نیست.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(MembershipService) private readonly memberships: MembershipService,
  ) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    const req = execution.switchToHttp().getRequest<AuthenticatedRequest>();
    const payload = req[AUTH_PAYLOAD_KEY];

    if (payload === undefined) {
      throw new UnauthorizedException('برای این عملیات باید وارد شوید');
    }

    /*
     * مستأجر درخواست از میان‌افزار BE-008 می‌آید (فعلاً هدر X-Tenant-Id).
     * نبودش یعنی این مسیر عمومی است ولی نگهبان نقش رویش سوار شده —
     * پیکربندی غلط، و امن‌ترین پاسخ رد کردن است نه عبور دادن.
     */
    if (!this.context.hasContext()) {
      throw new ForbiddenException('مستأجر درخواست مشخص نیست');
    }

    const tenantId = this.context.getTenantId();

    /*
     * «user خارج tenant» — توکن برای یک مستأجر صادر شده و درخواست به
     * مستأجر دیگری اشاره می‌کند.
     *
     * جست‌وجوی عضویتِ پایین‌تر بیشتر حالت‌ها را می‌گیرد، ولی **نه** حالتی
     * را که واقعاً خطرناک است: کاربری که عضو هر دو مستأجر است. آنجا
     * جست‌وجو موفق می‌شود و نقشِ مستأجر اشتباه را برمی‌گرداند، یعنی
     * صندوق‌دارِ یک طلافروشی با توکن همان‌جا روی طلافروشی دیگر مالک
     * می‌شد. تست «کاربر عضو دو مستأجر» دقیقاً همین را می‌سنجد.
     */
    if (payload.tid !== tenantId) {
      throw new ForbiddenException('این نشست به مستأجر دیگری تعلق دارد');
    }

    const role = await this.memberships.findRole(tenantId, payload.sub);

    if (role === undefined) {
      throw new ForbiddenException('شما عضو این مستأجر نیستید');
    }

    const allowed = this.reflector.getAllAndOverride<readonly RoleCode[] | undefined>(
      ROLES_METADATA_KEY,
      [execution.getHandler(), execution.getClass()],
    );

    // بدون `@Roles`، عضو بودن کافی است.
    if (allowed === undefined) {
      return true;
    }

    if (!allowed.includes(role)) {
      throw new ForbiddenException('نقش شما اجازه‌ی این عملیات را ندارد');
    }

    return true;
  }
}
