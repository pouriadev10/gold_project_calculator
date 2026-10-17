import { Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module';
import { UsersModule } from '../../platform/users/users.module';
import { PricingModule } from '../pricing/pricing.module';
import { PartyBalanceReportService } from './party-balance-report.service';
import { DashboardService } from './dashboard.service';
import { ReportingController } from './reporting.controller';
import { ReportingDisplayService } from './reporting-display.service';
import { ProfitReportService } from './profit-report.service';
import { RecentTransactionsController } from './recent-transactions.controller';
import { RecentTransactionsService } from './recent-transactions.service';

/**
 * گزارش دو مقیاسه (طلا و ریال) — BE-058 تا BE-060؛ آخرین معامله‌ها FE-106b.
 *
 * اسکلت خالی.
 */
@Module({
  imports: [AuthModule, PricingModule, UsersModule],
  controllers: [RecentTransactionsController, ReportingController],
  providers: [
    DashboardService,
    PartyBalanceReportService,
    ReportingDisplayService,
    ProfitReportService,
    RecentTransactionsService,
  ],
})
export class ReportingModule {}
