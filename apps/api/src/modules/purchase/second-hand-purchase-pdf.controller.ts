import type { StreamableFile } from '@nestjs/common';
import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import { uuidSchema } from '@gold/contracts';
import { JwtAuthGuard } from '../../platform/auth/jwt-auth.guard';
import { Roles } from '../../platform/auth/roles.decorator';
import { RolesGuard } from '../../platform/auth/roles.guard';
import { RequestContextService } from '../../platform/request-context/request-context.service';
import { ZodValidationPipe } from '../../shared/validation';
import { pdfResponse, type HeaderWriter } from '../../platform/files/pdf-response';
import { SecondHandPurchaseNotFoundError } from './second-hand-gold-purchases.errors';
import { SecondHandPurchasePdfService } from './second-hand-purchase-pdf.service';

@Controller('purchase/second-hand')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'MANAGER', 'CASHIER')
export class SecondHandPurchasePdfController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(SecondHandPurchasePdfService) private readonly pdf: SecondHandPurchasePdfService,
  ) {}

  @Get(':purchaseId/pdf')
  async getPdf(
    @Param('purchaseId', new ZodValidationPipe(uuidSchema)) purchaseId: string,
    @Res({ passthrough: true }) reply: HeaderWriter,
  ): Promise<StreamableFile> {
    try {
      const exported = await this.pdf.export(this.context.getTenantId(), purchaseId);
      return pdfResponse(reply, exported);
    } catch (error) {
      if (error instanceof SecondHandPurchaseNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }
}
