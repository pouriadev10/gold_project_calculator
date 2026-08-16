import { Controller, Get, Inject, NotFoundException, Query, UseGuards } from '@nestjs/common';
import { dashboardQuerySchema, partyBalanceReportQuerySchema } from '@gold/contracts';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import { PartyBalanceReportService } from './party-balance-report.service';
import { DashboardService } from './dashboard.service';
import { ReportingReferenceQuoteNotFoundError } from './reporting.errors';
import type {
  Dashboard,
  DashboardQuery,
  PartyBalanceReport,
  PartyBalanceReportQuery,
} from '@gold/contracts';

/** Tenant-isolated debtor and creditor report projections. */
@Controller('reporting')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportingController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(PartyBalanceReportService) private readonly reports: PartyBalanceReportService,
    @Inject(DashboardService) private readonly dashboard: DashboardService,
  ) {}

  @Get('debtors')
  async debtors(
    @Query(new ZodValidationPipe(partyBalanceReportQuerySchema)) query: PartyBalanceReportQuery,
  ): Promise<PartyBalanceReport> {
    return this.getReport('DEBTOR', query);
  }

  @Get('creditors')
  async creditors(
    @Query(new ZodValidationPipe(partyBalanceReportQuerySchema)) query: PartyBalanceReportQuery,
  ): Promise<PartyBalanceReport> {
    return this.getReport('CREDITOR', query);
  }

  @Get('dashboard')
  async getDashboard(
    @Query(new ZodValidationPipe(dashboardQuerySchema)) query: DashboardQuery,
  ): Promise<Dashboard> {
    return this.dashboard.getDashboard(this.context.getTenantId(), query);
  }

  private async getReport(
    direction: 'DEBTOR' | 'CREDITOR',
    query: PartyBalanceReportQuery,
  ): Promise<PartyBalanceReport> {
    try {
      return await this.reports.getReport(this.context.getTenantId(), direction, query);
    } catch (error) {
      if (error instanceof ReportingReferenceQuoteNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }
}
