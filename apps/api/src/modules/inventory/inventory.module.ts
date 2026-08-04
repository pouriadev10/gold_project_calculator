import { Module } from '@nestjs/common';
import { AuditModule } from '../../platform/audit/audit.module';
import { CoinTypesService } from './coin-types.service';
import { InitialCoinTypesService } from './initial-coin-types.service';

/**
 * کالای زیورآلات، آبشده و سکه — BE-025 تا BE-028.
 *
 * اسکلت خالی.
 */
@Module({
  imports: [AuditModule],
  providers: [CoinTypesService, InitialCoinTypesService],
  exports: [CoinTypesService, InitialCoinTypesService],
})
export class InventoryModule {}
