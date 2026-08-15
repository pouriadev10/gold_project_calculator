import { Module } from '@nestjs/common';
import { AuditModule } from '../../platform/audit/audit.module';
import { AuthModule } from '../../platform/auth/auth.module';
import { IdempotencyModule } from '../../platform/idempotency/idempotency.module';
import { UsersModule } from '../../platform/users/users.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PartiesModule } from '../parties/parties.module';
import { PricingModule } from '../pricing/pricing.module';
import { B2cBuybacksController } from './b2c-buybacks.controller';
import { B2cBuybacksService } from './b2c-buybacks.service';
import { SecondHandCoinPurchasesController } from './second-hand-coin-purchases.controller';
import { SecondHandCoinPurchasesService } from './second-hand-coin-purchases.service';
import { SecondHandGoldPurchasesController } from './second-hand-gold-purchases.controller';
import { SecondHandGoldPurchasesService } from './second-hand-gold-purchases.service';

/**
 * خرید از مصرف‌کننده و مرجوعی B2C به‌عنوان خرید دست‌دوم — BE-049 تا BE-052.
 *
 * هر خرید در یک تراکنش PostgreSQL، یک سند مبدأ، حرکت موجودی و posting متوازن
 * می‌سازد. مرجوعی B2C نیز در BE-052 از همین مسیر خرید استفاده می‌کند.
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
  controllers: [
    B2cBuybacksController,
    SecondHandGoldPurchasesController,
    SecondHandCoinPurchasesController,
  ],
  providers: [B2cBuybacksService, SecondHandGoldPurchasesService, SecondHandCoinPurchasesService],
  exports: [B2cBuybacksService, SecondHandGoldPurchasesService, SecondHandCoinPurchasesService],
})
export class PurchaseModule {}
