import { Module } from '@nestjs/common';
import { AuditModule } from '../../platform/audit/audit.module';
import { CoinTypesService } from './coin-types.service';
import { InitialCoinTypesService } from './initial-coin-types.service';
import { JewelryItemsService } from './jewelry-items.service';

/**
 * کالای زیورآلات، آبشده و سکه — BE-025 تا BE-028.
 *
 * مسیرهای HTTP کالای زیورآلات در BE-026 اضافه می‌شوند؛ فعلاً فقط مدل و
 * سرویس نسخه‌داری وجود دارد.
 */
@Module({
  imports: [AuditModule],
  providers: [CoinTypesService, InitialCoinTypesService, JewelryItemsService],
  exports: [CoinTypesService, InitialCoinTypesService, JewelryItemsService],
})
export class InventoryModule {}
