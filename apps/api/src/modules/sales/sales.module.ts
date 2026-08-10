import { Module } from '@nestjs/common';
import { AuditModule } from '../../platform/audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PartiesModule } from '../parties/parties.module';
import { PricingModule } from '../pricing/pricing.module';
import { DocumentCountersService } from './document-counters.service';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesPricingService } from './sales-pricing.service';

/**
 * فروش، فاکتور و اصلاح فاکتور — BE-038 تا BE-043 و BE-053 تا BE-055.
 *
 * مرجوعی B2C اینجا نیست؛ طبق بخش ۲-۵ قواعد پروژه یک خرید است و در
 * `purchase` پیاده می‌شود. `PartiesModule` فقط برای بررسی «Party فعال»
 * لازم است — همان الگوی وابستگی یک‌طرفه‌ی سرویسِ export‌شده که
 * `app.module.ts` تجویز می‌کند.
 */
@Module({
  imports: [AuditModule, InventoryModule, PartiesModule, PricingModule],
  providers: [DocumentCountersService, SalesInvoicesService, SalesPricingService],
  exports: [DocumentCountersService, SalesInvoicesService, SalesPricingService],
})
export class SalesModule {}
