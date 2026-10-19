import {
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentAuth } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PDF_FILE_NAME_HEADER } from '../files/pdf-response';
import { IdempotencyKeyConflictError } from '../idempotency/idempotency.errors';
import { IDEMPOTENCY_KEY_HEADER } from '../idempotency/idempotency-key';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { RequestContextService } from '../request-context/request-context.service';
import { TenantExportsService } from './tenant-exports.service';
import type { TenantExport } from '@gold/contracts';
import type { AccessTokenPayload } from '../auth/token.service';
import type { HeaderWriter } from '../files/pdf-response';

/** sha256 محتوای فایل، تا دریافت‌کننده سالم رسیدنش را بسنجد. */
export const CONTENT_SHA256_HEADER = 'X-Content-SHA256';

/**
 * خروجی کامل داده‌ی مستأجر — BE-069.
 *
 * فقط OWNER: این کل دفتر، مشتری‌ها (با کد ملی) و ممیزی کسب‌وکار است. مدیر
 * و صندوقدار هر کدام به بخشی دسترسی دارند، ولی خروج انبوه همه‌چیز تصمیم مالک است.
 */
@Controller('platform/exports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantExportsController {
  constructor(
    @Inject(RequestContextService) private readonly context: RequestContextService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(TenantExportsService) private readonly exports: TenantExportsService,
  ) {}

  @Post('full')
  @HttpCode(HttpStatus.CREATED)
  @Roles('OWNER')
  async create(
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<TenantExport> {
    if (auth === undefined) throw new UnauthorizedException();

    const tenantId = this.context.getTenantId();
    try {
      const result = await this.idempotency.execute({
        tenantId,
        key,
        // بدنه‌ای ندارد؛ هر بدنه‌ی ارسالی نادیده گرفته می‌شود تا تکرار با کلید یکسان همیشه replay باشد.
        request: { method: 'POST', path: '/platform/exports/full', body: {} },
        execute: async (transaction) => ({
          status: HttpStatus.CREATED,
          body: await this.exports.createInTransaction(transaction, { tenantId, requestedBy: auth.sub }),
        }),
      });
      return result.response.body;
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  /**
   * فایل JSON خروجی. مثل PDFها بدون `Content-Disposition` (FE-098)؛ نام فایل
   * در `X-File-Name` می‌آید.
   */
  @Get(':id')
  @Roles('OWNER')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AccessTokenPayload | undefined,
    @Res({ passthrough: true }) reply: HeaderWriter,
  ): Promise<StreamableFile> {
    if (auth === undefined) throw new UnauthorizedException();

    const tenantId = this.context.getTenantId();
    const found = await this.exports.findForDownload(tenantId, id);
    await this.exports.recordDownload(tenantId, id, auth.sub);

    const fileName = `tenant-export-${this.context.getTenantSlug()}-${found.snapshotAt.toISOString().slice(0, 10)}-${id.slice(0, 8)}.json`;
    reply.header(PDF_FILE_NAME_HEADER, encodeURIComponent(fileName));
    reply.header(CONTENT_SHA256_HEADER, found.contentSha256);

    return new StreamableFile(Buffer.from(found.content, 'utf8'), {
      type: 'application/json; charset=utf-8',
    });
  }
}
