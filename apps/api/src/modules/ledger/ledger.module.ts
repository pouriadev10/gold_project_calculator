import { Module } from '@nestjs/common';
import { AuditModule } from '../../platform/audit/audit.module';
import { AssetDimensionsService } from './asset-dimensions.service';
import { InitialAssetDimensionsService } from './initial-asset-dimensions.service';

/**
 * دفتر کل چندواحدی — قلب سیستم. BE-030 تا BE-037.
 *
 * اسکلت خالی. تنها مسیر مجاز ساخت تراکنش، سرویس posting این ماژول خواهد بود.
 */
@Module({
  imports: [AuditModule],
  providers: [AssetDimensionsService, InitialAssetDimensionsService],
  exports: [AssetDimensionsService, InitialAssetDimensionsService],
})
export class LedgerModule {}
