import { Module } from '@nestjs/common';
import { shouldRegisterDevEndpoints } from '../config/dev-endpoints';
import { DevIdempotencyController } from './dev-idempotency.controller';
import { IdempotencyService } from './idempotency.service';
import type { Type } from '@nestjs/common';

const DEV_CONTROLLERS: Type[] = shouldRegisterDevEndpoints() ? [DevIdempotencyController] : [];

/**
 * `Idempotency-Key` روی endpointهای نوشتنی — BE-013.
 */
@Module({
  providers: [IdempotencyService],
  controllers: DEV_CONTROLLERS,
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
