import { Global, Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule, Type } from '@nestjs/common';
import { shouldRegisterDevEndpoints } from '../config/dev-endpoints';
import { TenantModule } from '../tenant/tenant.module';
import { DevContextController } from './dev-context.controller';
import { RequestContextService } from './request-context.service';
import { TenantContextMiddleware } from './tenant-context.middleware';

const DEV_CONTROLLERS: Type[] = shouldRegisterDevEndpoints() ? [DevContextController] : [];

/**
 * context هر درخواست (مستأجر و کاربر جاری) با AsyncLocalStorage — BE-008.
 *
 * `@Global` است چون از BE-023 به بعد هر Service دامنه‌ای برای فیلتر کردن
 * روی مستأجر به آن نیاز دارد — همان استدلال `ConfigModule` و
 * `DatabaseModule`.
 *
 * میان‌افزار روی **همه‌ی** مسیرها اعمال می‌شود و استثناها داخل خودش
 * مدیریت می‌شوند. عمداً از `.exclude()` استفاده نشده: آن‌جا الگوی مسیر
 * است و یک اشتباه در نحو wildcard بی‌صدا باعث می‌شود میان‌افزار روی
 * مسیرهایی که باید محافظت شوند اجرا نشود — خرابی‌ای که هیچ تستی جز تست
 * دقیقاً همان مسیر نمی‌گیردش.
 */
@Global()
@Module({
  imports: [TenantModule],
  providers: [RequestContextService],
  controllers: DEV_CONTROLLERS,
  exports: [RequestContextService],
})
export class RequestContextModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
