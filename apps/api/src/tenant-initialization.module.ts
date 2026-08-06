import { Global, Module } from '@nestjs/common';
import { InventoryModule } from './modules/inventory/inventory.module';
import { InitialCoinTypesService } from './modules/inventory/initial-coin-types.service';
import { LedgerModule } from './modules/ledger/ledger.module';
import { InitialAssetDimensionsService } from './modules/ledger/initial-asset-dimensions.service';
import { InitialLedgerAccountsService } from './modules/ledger/initial-ledger-accounts.service';
import { PricingModule } from './modules/pricing/pricing.module';
import { InitialTenantSettingsService } from './modules/pricing/initial-tenant-settings.service';
import { CompositeTenantInitializer, TENANT_INITIALIZER } from './platform/tenant/tenant-initializer';

/**
 * Composition root for tenant setup. It keeps TenantModule dependent only on
 * its port while domain modules retain ownership of their own seed data.
 */
@Global()
@Module({
  imports: [PricingModule, LedgerModule, InventoryModule],
  providers: [
    {
      provide: TENANT_INITIALIZER,
      inject: [
        InitialTenantSettingsService,
        InitialAssetDimensionsService,
        InitialLedgerAccountsService,
        InitialCoinTypesService,
      ],
      useFactory: (
        settings: InitialTenantSettingsService,
        dimensions: InitialAssetDimensionsService,
        accounts: InitialLedgerAccountsService,
        coinTypes: InitialCoinTypesService,
      ): CompositeTenantInitializer =>
        new CompositeTenantInitializer([settings, dimensions, accounts, coinTypes]),
    },
  ],
  exports: [TENANT_INITIALIZER],
})
export class TenantInitializationModule {}
