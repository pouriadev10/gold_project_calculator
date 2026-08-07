import { Module } from '@nestjs/common';
import { AuditModule } from '../../platform/audit/audit.module';
import { AuthModule } from '../../platform/auth/auth.module';
import { IdempotencyModule } from '../../platform/idempotency/idempotency.module';
import { UsersModule } from '../../platform/users/users.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PricingModule } from '../pricing/pricing.module';
import { CoinTypesService } from './coin-types.service';
import { InitialCoinTypesService } from './initial-coin-types.service';
import { InventoryMovementsService } from './inventory-movements.service';
import { JewelryItemsController } from './jewelry-items.controller';
import { JewelryItemsService } from './jewelry-items.service';
import { OpeningBalancesController } from './opening-balances.controller';
import { OpeningBalancesService } from './opening-balances.service';

/**
 * کالای زیورآلات، آبشده و سکه — BE-025 تا BE-028.
 *
 * `AuthModule` و `UsersModule` برای نگهبان نقش لازم‌اند (نقش از دیتابیس
 * خوانده می‌شود، نه از توکن) و `IdempotencyModule` برای مسیرهای نوشتنی.
 *
 * `PricingModule` برای خواندن سیاست موجودی منفی از تنظیمات نسخه‌دار
 * وارد شده است. وابستگی یک‌طرفه است — pricing چیزی از inventory
 * نمی‌خواهد — و از راه سرویسِ صریحاً export‌شده می‌گذرد، همان چیزی که
 * `app.module.ts` برای ارتباط دو دامنه تجویز می‌کند.
 */
@Module({
  imports: [AuditModule, AuthModule, IdempotencyModule, LedgerModule, PricingModule, UsersModule],
  controllers: [JewelryItemsController, OpeningBalancesController],
  providers: [
    CoinTypesService,
    InitialCoinTypesService,
    InventoryMovementsService,
    JewelryItemsService,
    OpeningBalancesService,
  ],
  exports: [
    CoinTypesService,
    InitialCoinTypesService,
    InventoryMovementsService,
    JewelryItemsService,
    OpeningBalancesService,
  ],
})
export class InventoryModule {}
