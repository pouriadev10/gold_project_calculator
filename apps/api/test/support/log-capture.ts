import type { DestinationStream } from 'pino';

/**
 * مقصد حافظه‌ای log برای تست — جایگزین `LOG_DESTINATION`.
 *
 * خط خام را هم نگه می‌دارد تا تست‌های «داده‌ی حساس log نشود» روی متن واقعی
 * خروجی جست‌وجو کنند، نه روی شیئی که شاید پیش از سریال‌شدن بررسی شده باشد.
 */
export class LogCapture implements DestinationStream {
  readonly lines: string[] = [];

  write(line: string): void {
    this.lines.push(line);
  }

  records(): Record<string, unknown>[] {
    return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  text(): string {
    return this.lines.join('');
  }

  clear(): void {
    this.lines.length = 0;
  }
}
