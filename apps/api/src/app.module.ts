import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuditModule } from './platform/audit/audit.module';
import { AuthModule } from './platform/auth/auth.module';
import { DatabaseModule } from './platform/database/database.module';
import { IdempotencyModule } from './platform/idempotency/idempotency.module';
import { RequestContextModule } from './platform/request-context/request-context.module';
import { TenantModule } from './platform/tenant/tenant.module';
import { UsersModule } from './platform/users/users.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { PartiesModule } from './modules/parties/parties.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { PurchaseModule } from './modules/purchase/purchase.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { SalesModule } from './modules/sales/sales.module';
import { SettlementModule } from './modules/settlement/settlement.module';
import { TaxModule } from './modules/tax/tax.module';

/**
 * ماژول ریشه‌ی مونولیت ماژولار.
 *
 * دو خانواده‌ی ماژول داریم و مرزشان معنادار است:
 *
 * - `platform/` — زیرساخت افقی که همه‌ی دامنه‌ها از آن استفاده می‌کنند
 *   (دیتابیس، مستأجر، احراز هویت، ممیزی، تکرارناپذیری).
 * - `modules/`  — دامنه‌ی کسب‌وکار. هر کدام مالک جدول‌ها و قواعد خودش است.
 *
 * جهت وابستگی یک‌طرفه است: `modules/ → platform/ → shared/`.
 * ماژول دامنه‌ای نباید ماژول دامنه‌ای دیگری را import کند، وگرنه اولین
 * circular dependency از همان‌جا شروع می‌شود. جایی که دو دامنه به هم نیاز
 * دارند (مثلاً فروش و دفتر کل)، وابستگی از طریق سرویس صریحِ export‌شده‌ی
 * ماژول پایین‌دستی برقرار می‌شود، نه import دوطرفه.
 *
 * همه‌ی ماژول‌ها فعلاً اسکلت خالی‌اند — این تسک فقط مرزها را می‌سازد.
 */
@Module({
  imports: [
    // زیرساخت — ترتیب از پایین‌ترین لایه به بالا
    DatabaseModule,
    RequestContextModule,
    TenantModule,
    UsersModule,
    AuthModule,
    IdempotencyModule,
    AuditModule,

    // دامنه‌ی کسب‌وکار
    PricingModule,
    PartiesModule,
    InventoryModule,
    LedgerModule,
    SalesModule,
    PurchaseModule,
    SettlementModule,
    ReportingModule,

    // ⬜ فاز ۵ — عمداً بدون endpoint
    TaxModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
