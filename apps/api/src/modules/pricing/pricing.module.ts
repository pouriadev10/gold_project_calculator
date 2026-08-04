import { Module } from '@nestjs/common';
import { AuditModule } from '../../platform/audit/audit.module';
import { AuthModule } from '../../platform/auth/auth.module';
import { IdempotencyModule } from '../../platform/idempotency/idempotency.module';
import { UsersModule } from '../../platform/users/users.module';
import { InitialTenantSettingsService } from './initial-tenant-settings.service';
import { PriceQuotesController } from './price-quotes.controller';
import { PriceQuotesService } from './price-quotes.service';
import { VersionedSettingsService } from './versioned-settings.service';

/**
 * مظنه، عیار، اجرت و مالیات — BE-018 تا BE-022.
 *
 * زیرساخت settings نسخه‌دار از BE-018 اینجا زندگی می‌کند.
 */
@Module({
  imports: [AuditModule, AuthModule, IdempotencyModule, UsersModule],
  controllers: [PriceQuotesController],
  providers: [VersionedSettingsService, InitialTenantSettingsService, PriceQuotesService],
  exports: [VersionedSettingsService, InitialTenantSettingsService, PriceQuotesService],
})
export class PricingModule {}
