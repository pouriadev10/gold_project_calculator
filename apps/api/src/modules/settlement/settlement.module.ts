import { Module } from '@nestjs/common';
import { AuditModule } from '../../platform/audit/audit.module';
import { AuthModule } from '../../platform/auth/auth.module';
import { IdempotencyModule } from '../../platform/idempotency/idempotency.module';
import { UsersModule } from '../../platform/users/users.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PartiesModule } from '../parties/parties.module';
import { PricingModule } from '../pricing/pricing.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CoinSettlementsController } from './coin-settlements.controller';
import { CoinSettlementsService } from './coin-settlements.service';
import { GoldSettlementsController } from './gold-settlements.controller';
import { GoldSettlementsService } from './gold-settlements.service';
import { RialSettlementsController } from './rial-settlements.controller';
import { RialSettlementsService } from './rial-settlements.service';
import { SettlementsService } from './settlements.service';

/**
 * تسویه‌ی چندواحدی — ریال، طلا، سکه و مانده اعتباری. BE-044 تا BE-048.
 *
 * BE-044 مدل و چرخه‌ی عمر (draft/finalize) را ساخت؛ هر تسک بعدی یک
 * ابزار پرداخت را posting می‌کند. BE-045: ریال.
 */
@Module({
  imports: [
    AuditModule,
    AuthModule,
    IdempotencyModule,
    InventoryModule,
    LedgerModule,
    PartiesModule,
    PricingModule,
    UsersModule,
  ],
  controllers: [CoinSettlementsController, GoldSettlementsController, RialSettlementsController],
  providers: [
    CoinSettlementsService,
    GoldSettlementsService,
    RialSettlementsService,
    SettlementsService,
  ],
  exports: [
    CoinSettlementsService,
    GoldSettlementsService,
    RialSettlementsService,
    SettlementsService,
  ],
})
export class SettlementModule {}
