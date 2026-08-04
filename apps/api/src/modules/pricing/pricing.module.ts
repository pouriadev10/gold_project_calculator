import { Module } from '@nestjs/common';
import { AuditModule } from '../../platform/audit/audit.module';
import { AuthModule } from '../../platform/auth/auth.module';
import { IdempotencyModule } from '../../platform/idempotency/idempotency.module';
import { UsersModule } from '../../platform/users/users.module';
import { InitialTenantSettingsService } from './initial-tenant-settings.service';
import {
  PRICE_FEED_PROVIDER,
  PRICE_FEED_TIMEOUT_MS,
  UnavailablePriceFeedProvider,
} from './price-feed.provider';
import { PriceFeedService } from './price-feed.service';
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
  providers: [
    VersionedSettingsService,
    InitialTenantSettingsService,
    PriceQuotesService,
    PriceFeedService,
    { provide: PRICE_FEED_PROVIDER, useClass: UnavailablePriceFeedProvider },
    { provide: PRICE_FEED_TIMEOUT_MS, useValue: 5_000 },
  ],
  exports: [
    VersionedSettingsService,
    InitialTenantSettingsService,
    PriceQuotesService,
    PriceFeedService,
  ],
})
export class PricingModule {}
