import { apiGetFile, apiPost, type DownloadedFile } from './client';
import { tenantExportSchema, type TenantExport } from './contracts';

/**
 * سرور خروجی را هم‌زمان با درخواست می‌سازد (نه در صف)؛ برای مستأجر یک‌ساله فایل حدود ۲۰
 * مگابایت است، پس مهلت پیش‌فرض درخواست‌ها کافی نیست.
 */
const TENANT_EXPORT_TIMEOUT_MS = 120_000;

/**
 * ساخت خروجی کامل داده‌ی مستأجر — `POST /platform/exports/full` (BE-069). بدنه ندارد؛ فقط OWNER.
 * تنها نوشتنی است که مستأجر معلق هم مجاز است (D-03). همان الگوی `createParty`: صفحه مستقیماً
 * با `useIdempotentSubmit` می‌پوشاند.
 */
export function createTenantExport(idempotencyKey: string, signal?: AbortSignal): Promise<TenantExport> {
  return apiPost('/platform/exports/full', {}, tenantExportSchema, idempotencyKey, signal, TENANT_EXPORT_TIMEOUT_MS);
}

/** فایل JSON همان خروجی — `GET /platform/exports/:id`. نام فایل در `X-File-Name` می‌آید. */
export function getTenantExportFile(exportId: string, signal?: AbortSignal): Promise<DownloadedFile> {
  return apiGetFile(`/platform/exports/${exportId}`, signal, TENANT_EXPORT_TIMEOUT_MS, 'application/json');
}
