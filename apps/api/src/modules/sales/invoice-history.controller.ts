import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { uuidSchema } from '@gold/contracts';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import { SalesInvoiceNotFoundError } from './sales-invoices.errors';
import { InvoiceHistoryService } from './invoice-history.service';
import { SalesInvoicePdfService } from './sales-invoice-pdf.service';
import type { SalesInvoiceAmendmentHistory, SalesInvoiceVersionHistory } from '@gold/contracts';

/** Immutable, tenant-scoped invoice history. Cashiers may view, but never amend from this route. */
@Controller('sales/invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class InvoiceHistoryController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(InvoiceHistoryService) private readonly history: InvoiceHistoryService,
    @Inject(SalesInvoicePdfService) private readonly pdf: SalesInvoicePdfService,
  ) {}

  @Get(':invoiceId/pdf')
  async getPdf(
    @Param('invoiceId', new ZodValidationPipe(uuidSchema)) invoiceId: string,
  ): Promise<StreamableFile> {
    try {
      const exported = await this.pdf.export(this.context.getTenantId(), invoiceId);
      return new StreamableFile(exported.content, {
        type: exported.contentType,
        disposition: `attachment; filename="${exported.fileName}"`,
      });
    } catch (error) {
      if (error instanceof SalesInvoiceNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }

  @Get(':invoiceId/versions')
  async getVersions(
    @Param('invoiceId', new ZodValidationPipe(uuidSchema)) invoiceId: string,
  ): Promise<SalesInvoiceVersionHistory> {
    try {
      return await this.history.getVersions(this.context.getTenantId(), invoiceId);
    } catch (error) {
      if (error instanceof SalesInvoiceNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }

  @Get(':invoiceId/amendments')
  async getAmendments(
    @Param('invoiceId', new ZodValidationPipe(uuidSchema)) invoiceId: string,
  ): Promise<SalesInvoiceAmendmentHistory> {
    try {
      return await this.history.getAmendments(this.context.getTenantId(), invoiceId);
    } catch (error) {
      if (error instanceof SalesInvoiceNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }
}
