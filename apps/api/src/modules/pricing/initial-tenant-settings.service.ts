import { Inject, Injectable } from '@nestjs/common';
import { TENANT_INITIALIZER } from '../../platform/tenant/tenant-initializer';
import { INITIAL_TENANT_SETTINGS } from './tenant-initial-settings';
import { VersionedSettingsService } from './versioned-settings.service';
import type {
  TenantInitializationInput,
  TenantInitializer,
} from '../../platform/tenant/tenant-initializer';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

/** Seeds every required Phase-1 setting inside the transaction that creates the tenant. */
@Injectable()
export class InitialTenantSettingsService implements TenantInitializer {
  constructor(
    @Inject(VersionedSettingsService)
    private readonly versionedSettings: VersionedSettingsService,
  ) {}

  async initializeInTransaction(
    transaction: TenantTransaction,
    input: TenantInitializationInput,
  ): Promise<void> {
    for (const setting of INITIAL_TENANT_SETTINGS) {
      await this.versionedSettings.createVersionInTransaction(transaction, {
        tenantId: input.tenantId,
        settingKey: setting.settingKey,
        valueJson: setting.valueJson,
        validFrom: input.validFrom,
        createdBy: null,
      });
    }
  }
}

/** Binding token used by TenantModule; exported here to keep the dependency through a port. */
export const INITIAL_TENANT_SETTINGS_PROVIDER = {
  provide: TENANT_INITIALIZER,
  useExisting: InitialTenantSettingsService,
};
