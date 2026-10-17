import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { salesInvoiceListQuerySchema, uuidSchema } from '@gold/contracts';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import { SalesInvoiceNotFoundError } from './sales-invoices.errors';
import { SalesInvoiceReadsService } from './sales-invoice-reads.service';
import type { SalesInvoiceDetail, SalesInvoiceList, SalesInvoiceListQuery } from '@gold/contracts';

/**
 * Read-only, tenant-scoped invoice list and detail — FE-106b. Cashiers may view
 * (same as invoice history); nothing on this controller writes.
 */
@Controller('sales/invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class SalesInvoiceReadsController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(SalesInvoiceReadsService) private readonly reads: SalesInvoiceReadsService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(salesInvoiceListQuerySchema)) query: SalesInvoiceListQuery,
  ): Promise<SalesInvoiceList> {
    return this.reads.list(this.context.getTenantId(), query);
  }

  @Get(':invoiceId/detail')
  async detail(
    @Param('invoiceId', new ZodValidationPipe(uuidSchema)) invoiceId: string,
  ): Promise<SalesInvoiceDetail> {
    try {
      return await this.reads.detail(this.context.getTenantId(), invoiceId);
    } catch (error) {
      if (error instanceof SalesInvoiceNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }
}
