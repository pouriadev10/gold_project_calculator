import { z } from 'zod';
import { isoDateTimeSchema } from '../common/date-time.js';
import { uuidSchema } from '../common/identifier.js';

/**
 * خروجی کامل داده‌ی مستأجر — BE-069.
 *
 * دو قرارداد جدا:
 *
 * - `tenantExportSchema`: پاسخ `POST /platform/exports/full` — فراداده‌ی خروجی.
 * - `tenantExportDocumentSchema`: پوسته‌ی فایل دانلودی `GET /platform/exports/:id`.
 *   ردیف‌های هر بخش عمداً اینجا تک‌تک typed نیستند: شکلشان همان ستون‌های جدول
 *   است و در `docs/tenant-export.md` مستند شده. نسخه‌ی شکل با `schemaVersion`
 *   اعلام می‌شود، نه با حدس از روی محتوا.
 */

/** شناسه‌ی قالب فایل — مصرف‌کننده پیش از هر چیز این را بررسی می‌کند. */
export const TENANT_EXPORT_FORMAT = 'gold-tenant-export';

/**
 * نسخه‌ی شکل فایل. هر تغییر ناسازگار (حذف یا تغییر نام بخش/ستون، تغییر
 * قرارداد مقدار) یعنی +۱. افزودن بخش یا ستون تازه سازگار است و نسخه را عوض نمی‌کند.
 */
export const TENANT_EXPORT_SCHEMA_VERSION = 1;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

export const tenantExportSchema = z.object({
  id: uuidSchema,
  format: z.literal(TENANT_EXPORT_FORMAT),
  schemaVersion: z.number().int().positive(),
  snapshotAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  requestedBy: uuidSchema.nullable(),
  /** اندازه‌ی فایل به بایت. پول یا وزن نیست؛ عدد معمولی است. */
  byteSize: z.number().int().nonnegative(),
  sha256: sha256Schema,
  rowCounts: z.record(z.string(), z.number().int().nonnegative()),
});

const exportSectionSchema = z.object({
  /** نام جدول مبدأ در دیتابیس — برای کسی که فایل را به جدول برمی‌گرداند. */
  table: z.string().min(1),
  rowCount: z.number().int().nonnegative(),
  rows: z.array(z.record(z.string(), z.unknown())),
});

export const tenantExportDocumentSchema = z
  .object({
    format: z.literal(TENANT_EXPORT_FORMAT),
    schemaVersion: z.number().int().positive(),
    exportId: uuidSchema,
    snapshotAt: isoDateTimeSchema,
    requestedBy: uuidSchema.nullable(),
    tenant: z.object({
      id: uuidSchema,
      name: z.string(),
      slug: z.string(),
      status: z.string(),
      timezone: z.string(),
    }),
    sections: z.record(z.string(), exportSectionSchema),
  })
  .superRefine((document, context) => {
    for (const [name, section] of Object.entries(document.sections)) {
      if (section.rowCount !== section.rows.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sections', name, 'rowCount'],
          message: 'rowCount با تعداد ردیف‌ها برابر نیست',
        });
      }
    }
  });

export type TenantExport = z.infer<typeof tenantExportSchema>;
export type TenantExportDocument = z.infer<typeof tenantExportDocumentSchema>;
