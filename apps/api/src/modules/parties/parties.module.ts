import { Module } from '@nestjs/common';
import { AuditModule } from '../../platform/audit/audit.module';
import { AuthModule } from '../../platform/auth/auth.module';
import { IdempotencyModule } from '../../platform/idempotency/idempotency.module';
import { UsersModule } from '../../platform/users/users.module';
import { PartiesController } from './parties.controller';
import { PartiesService } from './parties.service';

/**
 * اشخاص و مانده‌های چندواحدی آن‌ها — BE-023، BE-024 و BE-056 تا BE-057.
 *
 * اسکلت خالی.
 */
@Module({
  imports: [AuditModule, AuthModule, IdempotencyModule, UsersModule],
  controllers: [PartiesController],
  providers: [PartiesService],
  exports: [PartiesService],
})
export class PartiesModule {}
