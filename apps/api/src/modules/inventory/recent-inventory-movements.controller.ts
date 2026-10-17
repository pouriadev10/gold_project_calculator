import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { recentQuerySchema } from '@gold/contracts';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import { RecentInventoryMovementsService } from './recent-inventory-movements.service';
import type { RecentInventoryMovement, RecentQuery } from '@gold/contracts';

/** Read-only, tenant-scoped latest inventory movements for the inventory dashboard — FE-106b. */
@Controller('inventory/movements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class RecentInventoryMovementsController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(RecentInventoryMovementsService) private readonly movements: RecentInventoryMovementsService,
  ) {}

  @Get('recent')
  async recent(
    @Query(new ZodValidationPipe(recentQuerySchema)) query: RecentQuery,
  ): Promise<RecentInventoryMovement[]> {
    return this.movements.recent(this.context.getTenantId(), query.limit);
  }
}
