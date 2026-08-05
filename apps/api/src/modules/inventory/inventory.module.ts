import { Module } from '@nestjs/common';
import { AuditModule } from '../../platform/audit/audit.module';
import { AuthModule } from '../../platform/auth/auth.module';
import { IdempotencyModule } from '../../platform/idempotency/idempotency.module';
import { UsersModule } from '../../platform/users/users.module';
import { CoinTypesService } from './coin-types.service';
import { InitialCoinTypesService } from './initial-coin-types.service';
import { JewelryItemsController } from './jewelry-items.controller';
import { JewelryItemsService } from './jewelry-items.service';

/**
 * کالای زیورآلات، آبشده و سکه — BE-025 تا BE-028.
 *
 * `AuthModule` و `UsersModule` برای نگهبان نقش لازم‌اند (نقش از دیتابیس
 * خوانده می‌شود، نه از توکن) و `IdempotencyModule` برای مسیرهای نوشتنی.
 */
@Module({
  imports: [AuditModule, AuthModule, IdempotencyModule, UsersModule],
  controllers: [JewelryItemsController],
  providers: [CoinTypesService, InitialCoinTypesService, JewelryItemsService],
  exports: [CoinTypesService, InitialCoinTypesService, JewelryItemsService],
})
export class InventoryModule {}
