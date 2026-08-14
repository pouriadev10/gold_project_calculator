import { Module } from '@nestjs/common';
import { AuditModule } from '../../platform/audit/audit.module';
import { AuthModule } from '../../platform/auth/auth.module';
import { IdempotencyModule } from '../../platform/idempotency/idempotency.module';
import { UsersModule } from '../../platform/users/users.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PartiesModule } from '../parties/parties.module';
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
  imports: [AuditModule, AuthModule, IdempotencyModule, LedgerModule, PartiesModule, UsersModule],
  controllers: [RialSettlementsController],
  providers: [RialSettlementsService, SettlementsService],
  exports: [RialSettlementsService, SettlementsService],
})
export class SettlementModule {}
