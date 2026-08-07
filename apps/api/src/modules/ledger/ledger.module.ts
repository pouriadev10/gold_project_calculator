import { Module } from '@nestjs/common';
import { AuditModule } from '../../platform/audit/audit.module';
import { AssetDimensionsService } from './asset-dimensions.service';
import { InitialAssetDimensionsService } from './initial-asset-dimensions.service';
import { InitialLedgerAccountsService } from './initial-ledger-accounts.service';
import { LedgerAccountsService } from './ledger-accounts.service';
import { LedgerPostingService } from './ledger-posting.service';
import { LedgerReversalService } from './ledger-reversal.service';

/**
 * دفتر کل چندواحدی — قلب سیستم. BE-030 تا BE-037.
 *
 * تنها مسیر مجاز ساخت تراکنش، `LedgerPostingService` این ماژول است؛
 * `LedgerReversalService` هم فقط از همان مسیر عبور می‌کند، insert مستقیم
 * ندارد.
 */
@Module({
  imports: [AuditModule],
  providers: [
    AssetDimensionsService,
    InitialAssetDimensionsService,
    InitialLedgerAccountsService,
    LedgerAccountsService,
    LedgerPostingService,
    LedgerReversalService,
  ],
  exports: [
    AssetDimensionsService,
    InitialAssetDimensionsService,
    InitialLedgerAccountsService,
    LedgerAccountsService,
    LedgerPostingService,
    LedgerReversalService,
  ],
})
export class LedgerModule {}
