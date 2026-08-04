import { Module } from '@nestjs/common';
import { AuditModule } from '../../platform/audit/audit.module';
import { VersionedSettingsService } from './versioned-settings.service';

/**
 * مظنه، عیار، اجرت و مالیات — BE-018 تا BE-022.
 *
 * زیرساخت settings نسخه‌دار از BE-018 اینجا زندگی می‌کند.
 */
@Module({
  imports: [AuditModule],
  providers: [VersionedSettingsService],
  exports: [VersionedSettingsService],
})
export class PricingModule {}
