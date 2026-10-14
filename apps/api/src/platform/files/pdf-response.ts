import { StreamableFile } from '@nestjs/common';
import type { ExportedFile } from './invoice-exporter';

/**
 * هدر نام فایل PDF — FE-098. مقدار، نام فایل با `encodeURIComponent` است (UTF-8 ِ امن برای هدر،
 * پس نام فارسی هم سالم می‌رسد).
 */
export const PDF_FILE_NAME_HEADER = 'X-File-Name';

/** تنها بخشی از پاسخ Fastify که اینجا لازم است؛ وابستگی مستقیم به تایپ‌های fastify نمی‌سازد. */
export interface HeaderWriter {
  header(name: string, value: string): unknown;
}

/**
 * پاسخ PDF ِ همه‌ی endpointهای سند (فاکتور، رسید خرید، صورت‌حساب).
 *
 * **عمداً بدون `Content-Disposition`.** کلاینت PDF را با `fetch` می‌گیرد و خودش ذخیره، پیش‌نمایش یا
 * اشتراک می‌کند. نرم‌افزارهای امنیتی وب (روی دستگاه آزمون: ESET) هر پاسخی با `Content-Disposition`
 * — حتی `inline` ِ خالی — را از مرورگر می‌گیرند و به `fetch` یک `204` ِ خالی تحویل می‌دهند؛ پس روی
 * همان دستگاه‌ها «دریافت PDF» همیشه شکست می‌خورد (FE-098، آزمون E2E). نام فایل در هدر سفارشی می‌آید.
 */
export function pdfResponse(reply: HeaderWriter, exported: ExportedFile): StreamableFile {
  reply.header(PDF_FILE_NAME_HEADER, encodeURIComponent(exported.fileName));
  return new StreamableFile(exported.content, { type: exported.contentType });
}
