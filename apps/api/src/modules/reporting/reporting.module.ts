import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { UsersModule } from '../../platform/users/users.module';
import { PricingModule } from '../pricing/pricing.module';
import { PartyBalanceReportService } from './party-balance-report.service';
import { DashboardService } from './dashboard.service';
import { ReportingController } from './reporting.controller';
import { ReportingDisplayService } from './reporting-display.service';

/**
 * گزارش دو مقیاسه (طلا و ریال) — BE-058 تا BE-060.
 *
 * اسکلت خالی.
 */
@Module({
  imports: [AuthModule, PricingModule, UsersModule],
  controllers: [ReportingController],
  providers: [DashboardService, PartyBalanceReportService, ReportingDisplayService],
})
export class ReportingModule {}
