import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { UsersModule } from '../../platform/users/users.module';
import { PricingModule } from '../pricing/pricing.module';
import { PartyBalanceReportService } from './party-balance-report.service';
import { ReportingController } from './reporting.controller';

/**
 * گزارش دو مقیاسه (طلا و ریال) — BE-058 تا BE-060.
 *
 * اسکلت خالی.
 */
@Module({
  imports: [AuthModule, PricingModule, UsersModule],
  controllers: [ReportingController],
  providers: [PartyBalanceReportService],
})
export class ReportingModule {}
