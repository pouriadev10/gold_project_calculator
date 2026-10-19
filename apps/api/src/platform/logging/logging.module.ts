import { Global, Module } from '@nestjs/common';
import pino from 'pino';
import { APP_CONFIG } from '../config/config.module';
import { createAppLogger } from './app-logger';
import { APP_LOGGER, LOG_DESTINATION } from './logging.tokens';
import { NestPinoLogger } from './nest-logger';
import { RequestLoggingMiddleware } from './request-logging.middleware';
import type { DestinationStream } from 'pino';

/** شماره‌ی file descriptor خروجی استاندارد. */
const STDOUT_FD = 1;

/**
 * Logging ساختاریافته — BE-067.
 *
 * `@Global` به همان دلیل `ConfigModule`: filter خطا، middlewareها و هر سرویسی
 * که بخواهد log بنویسد به آن نیاز دارد.
 */
@Global()
@Module({
  providers: [
    {
      provide: LOG_DESTINATION,
      useFactory: (): DestinationStream => pino.destination(STDOUT_FD),
    },
    {
      provide: APP_LOGGER,
      inject: [APP_CONFIG, LOG_DESTINATION],
      useFactory: createAppLogger,
    },
    NestPinoLogger,
    RequestLoggingMiddleware,
  ],
  exports: [APP_LOGGER, NestPinoLogger, RequestLoggingMiddleware],
})
export class LoggingModule {}
