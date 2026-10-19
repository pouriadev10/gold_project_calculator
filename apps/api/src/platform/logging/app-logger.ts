import pino from 'pino';
import { sanitizeLogRecord } from './log-sanitizer';
import { requestLogBindings } from './request-log';
import type { DestinationStream, Logger } from 'pino';
import type { AppConfig } from '../config/env.schema';

/** نام سرویس در هر خط log — وقتی log چند سرویس در یک جا جمع می‌شود. */
const SERVICE_NAME = 'gold-api';

export type AppLogger = Logger;

/**
 * logger ساختاریافته‌ی برنامه — BE-067.
 *
 * هر خط یک شیء JSON است. دو چیز روی **همه‌ی** خط‌ها اعمال می‌شود، نه به
 * انتخاب فراخواننده:
 *
 * - `mixin`: هر log داخل یک درخواست HTTP خودش `requestId`/`tenantId`/`userId`
 *   را می‌گیرد. نویسنده‌ی log لازم نیست به یاد بیاورد آن‌ها را اضافه کند.
 * - `formatters.log`: پاک‌سازی رمز/توکن/کد ملی بعد از ادغام mixin، پس هیچ
 *   مسیری از کنارش رد نمی‌شود.
 */
export function createAppLogger(config: AppConfig, destination: DestinationStream): AppLogger {
  return pino(
    {
      level: config.logLevel,
      base: { service: SERVICE_NAME },
      timestamp: pino.stdTimeFunctions.isoTime,
      mixin: requestLogBindings,
      formatters: {
        level: (label) => ({ level: label }),
        log: sanitizeLogRecord,
      },
    },
    destination,
  );
}

/** stack فقط جایی که خواننده‌ی log توسعه‌دهنده است. */
export function shouldLogStackTraces(config: AppConfig): boolean {
  return config.nodeEnv !== 'production';
}
