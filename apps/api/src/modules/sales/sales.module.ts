import { Module } from '@nestjs/common';
import { AuditModule } from '../../platform/audit/audit.module';
import { AuthModule } from '../../platform/auth/auth.module';
import { FilesModule } from '../../platform/files/files.module';
import { IdempotencyModule } from '../../platform/idempotency/idempotency.module';
import { UsersModule } from '../../platform/users/users.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PartiesModule } from '../parties/parties.module';
import { PricingModule } from '../pricing/pricing.module';
import { CoinSalesController } from './coin-sales.controller';
import { CoinSalesService } from './coin-sales.service';
import { DocumentCountersService } from './document-counters.service';
import { InvoiceAmendmentsController } from './invoice-amendments.controller';
import { InvoiceAmendmentsService } from './invoice-amendments.service';
import { InvoiceHistoryController } from './invoice-history.controller';
import { InvoiceHistoryService } from './invoice-history.service';
import { JewelryCashSalesController } from './jewelry-cash-sales.controller';
import { JewelryCashSalesService } from './jewelry-cash-sales.service';
import { JewelryCreditSalesController } from './jewelry-credit-sales.controller';
import { JewelryCreditSalesService } from './jewelry-credit-sales.service';
import { InvoiceAmendmentPolicyService } from './invoice-amendment-policy.service';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesInvoicePdfService } from './sales-invoice-pdf.service';
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
  imports: [
    AuditModule,
    AuthModule,
    FilesModule,
    IdempotencyModule,
    InventoryModule,
    LedgerModule,
    PartiesModule,
    PricingModule,
    UsersModule,
  ],
  controllers: [
    CoinSalesController,
    InvoiceAmendmentsController,
    InvoiceHistoryController,
    JewelryCashSalesController,
    JewelryCreditSalesController,
  ],
  providers: [
    CoinSalesService,
    DocumentCountersService,
    JewelryCashSalesService,
    JewelryCreditSalesService,
    InvoiceAmendmentsService,
    InvoiceHistoryService,
    InvoiceAmendmentPolicyService,
    SalesInvoicesService,
    SalesInvoicePdfService,
    SalesPricingService,
  ],
  exports: [
    CoinSalesService,
    DocumentCountersService,
    JewelryCashSalesService,
    JewelryCreditSalesService,
    InvoiceAmendmentsService,
    InvoiceHistoryService,
    InvoiceAmendmentPolicyService,
    SalesInvoicesService,
    SalesPricingService,
  ],
})
export class SalesModule {}
