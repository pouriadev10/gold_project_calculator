import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../../platform/audit/audit.module';
import {
  InitialTenantSettingsService,
  INITIAL_TENANT_SETTINGS_PROVIDER,
} from './initial-tenant-settings.service';
import { VersionedSettingsService } from './versioned-settings.service';

/**
 * مظنه، عیار، اجرت و مالیات — BE-018 تا BE-022.
 *
 * زیرساخت settings نسخه‌دار از BE-018 اینجا زندگی می‌کند.
 */
@Global()
@Module({
  imports: [AuditModule],
  providers: [
    VersionedSettingsService,
    InitialTenantSettingsService,
    INITIAL_TENANT_SETTINGS_PROVIDER,
  ],
  exports: [VersionedSettingsService, INITIAL_TENANT_SETTINGS_PROVIDER],
})
export class PricingModule {}
