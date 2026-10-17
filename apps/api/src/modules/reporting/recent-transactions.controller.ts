import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { recentQuerySchema } from '@gold/contracts';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import { RecentTransactionsService } from './recent-transactions.service';
import type { RecentQuery, RecentTransactionList } from '@gold/contracts';

/** Read-only, tenant-scoped "latest trades" for the home screen — FE-106b. */
@Controller('transactions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class RecentTransactionsController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(RecentTransactionsService) private readonly transactions: RecentTransactionsService,
  ) {}

  @Get('recent')
  async recent(
    @Query(new ZodValidationPipe(recentQuerySchema)) query: RecentQuery,
  ): Promise<RecentTransactionList> {
    return this.transactions.recent(this.context.getTenantId(), query.limit);
  }
}
