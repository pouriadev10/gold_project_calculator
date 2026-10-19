import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { TenantModule } from '../tenant/tenant.module';
import { UsersModule } from '../users/users.module';
import { TenantExportsController } from './tenant-exports.controller';
import { TenantExportsService } from './tenant-exports.service';

/** خروجی کامل داده‌ی مستأجر — BE-069. */
@Module({
  imports: [AuditModule, AuthModule, IdempotencyModule, TenantModule, UsersModule],
  controllers: [TenantExportsController],
  providers: [TenantExportsService],
})
export class TenantExportsModule {}
