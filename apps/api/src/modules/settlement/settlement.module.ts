import { Module } from '@nestjs/common';
import { AuditModule } from '../../platform/audit/audit.module';
import { PartiesModule } from '../parties/parties.module';
import { SettlementsService } from './settlements.service';

/**
 * تسویه‌ی چندواحدی — ریال، طلا، سکه و مانده اعتباری. BE-044 تا BE-048.
 *
 * BE-044 فقط مدل و چرخه‌ی عمر (draft/finalize) است؛ posting دفتر کل و
 * inventory برای هر ابزار پرداخت کار BE-045 تا BE-048 است.
 */
@Module({
  imports: [AuditModule, PartiesModule],
  providers: [SettlementsService],
  exports: [SettlementsService],
})
export class SettlementModule {}
