import { Module } from '@nestjs/common';
import { shouldRegisterDevEndpoints } from '../config/dev-endpoints';
import { DevTenantController } from './dev-tenant.controller';
import { TenantService } from './tenant.service';
import type { Type } from '@nestjs/common';

/*
 * در production این آرایه خالی است، یعنی controller اصلاً نمونه‌سازی
 * نمی‌شود و مسیر در جدول مسیریابی Fastify وجود ندارد. نتیجه یک ۴۰۴
 * طبیعی است، نه یک نگهبان زمان‌اجرا که فراموش‌شدن یا دور زدنش ممکن باشد.
 */
const DEV_CONTROLLERS: Type[] = shouldRegisterDevEndpoints() ? [DevTenantController] : [];

/**
 * مستأجر و چرخه‌ی عمر آن — BE-007.
 *
 * `TenantService` صادر می‌شود چون میان‌افزار BE-008 برای تبدیل هدر
 * `X-Tenant-Id` به مستأجر و بررسی فعال بودنش به آن نیاز دارد.
 */
@Module({
  providers: [TenantService],
  controllers: DEV_CONTROLLERS,
  exports: [TenantService],
})
export class TenantModule {}
