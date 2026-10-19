import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module';
import { shouldLogStackTraces } from './app-logger';
import { APP_LOGGER } from './logging.tokens';
import type { AppConfig } from '../config/env.schema';
import type { AppLogger } from './app-logger';

function readContext(params: readonly unknown[]): string | undefined {
  const last = params.at(-1);
  return typeof last === 'string' ? last : undefined;
}

function toMessage(message: unknown): string {
  return typeof message === 'string' ? message : JSON.stringify(message) ?? String(message);
}

/**
 * log خود Nest (راه‌اندازی، مسیریابی، خطای ماژول‌ها) هم از همان pino رد
 * می‌شود تا خروجی سرور یک قالب داشته باشد. `main.ts` آن را با `useLogger`
 * نصب می‌کند.
 */
@Injectable()
export class NestPinoLogger implements LoggerService {
  constructor(
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  log(message: unknown, ...params: unknown[]): void {
    this.logger.info({ context: readContext(params) }, toMessage(message));
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.logger.warn({ context: readContext(params) }, toMessage(message));
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.logger.debug({ context: readContext(params) }, toMessage(message));
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.logger.trace({ context: readContext(params) }, toMessage(message));
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.logger.fatal({ context: readContext(params) }, toMessage(message));
  }

  /** امضای Nest: `error(message, stack?, context?)`. */
  error(message: unknown, ...params: unknown[]): void {
    const stack = params.length >= 2 && typeof params[0] === 'string' ? params[0] : undefined;

    this.logger.error(
      {
        context: params.length >= 2 ? readContext(params) : undefined,
        stack: shouldLogStackTraces(this.config) ? stack : undefined,
      },
      toMessage(message),
    );
  }
}
