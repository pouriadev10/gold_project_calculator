import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../shared/validation';
import { rlsProbes } from '../database/schema';
import { RequestContextService } from '../request-context/request-context.service';
import {
  IdempotencyKeyConflictError,
  InvalidIdempotencyKeyError,
  InvalidIdempotencyRequestError,
  MissingIdempotencyKeyError,
} from './idempotency.errors';
import { IDEMPOTENCY_KEY_HEADER } from './idempotency-key';
import { IdempotencyService } from './idempotency.service';

const idempotencyProbeSchema = z
  .object({
    note: z.string().trim().min(1).max(200),
  })
  .strict();

type IdempotencyProbeInput = z.infer<typeof idempotencyProbeSchema>;

interface IdempotencyProbeResponse {
  readonly id: string;
  readonly note: string;
}

/**
 * مسیر آزمایشی برای ثابت‌کردن قرارداد BE-013 با HTTP و PostgreSQL واقعی.
 *
 * در production اصلاً ثبت نمی‌شود. endpointهای مالی آینده دقیقاً همین الگو را
 * استفاده می‌کنند، با این تفاوت که callback آن‌ها inventory، ledger و سند مالی
 * را با transaction دریافتی ثبت می‌کند.
 */
@Controller('internal/dev/idempotency')
export class DevIdempotencyController {
  constructor(
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(RequestContextService) private readonly context: RequestContextService,
  ) {}

  @Post('probe')
  @HttpCode(HttpStatus.CREATED)
  async createProbe(
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
    @Body(new ZodValidationPipe(idempotencyProbeSchema)) body: IdempotencyProbeInput,
  ): Promise<IdempotencyProbeResponse> {
    try {
      const tenantId = this.context.getTenantId();
      const result = await this.idempotency.execute({
        tenantId,
        key,
        request: {
          method: 'POST',
          path: '/internal/dev/idempotency/probe',
          body,
        },
        execute: async (transaction) => {
          const [created] = await transaction
            .insert(rlsProbes)
            .values({ tenantId, note: body.note })
            .returning();

          return {
            status: HttpStatus.CREATED,
            body: { id: created!.id, note: created!.note },
          };
        },
      });

      return result.response.body;
    } catch (error) {
      if (error instanceof IdempotencyKeyConflictError) {
        throw new ConflictException(error.message);
      }
      if (
        error instanceof InvalidIdempotencyKeyError ||
        error instanceof InvalidIdempotencyRequestError ||
        error instanceof MissingIdempotencyKeyError
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
