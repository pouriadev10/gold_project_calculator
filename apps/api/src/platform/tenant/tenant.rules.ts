import { TenantNotWritableError } from './tenant.errors';
import type { Tenant, TenantStatus } from '../database/schema';

/** تنها وضعیتی که اجازه‌ی نوشتن می‌دهد. */
const WRITABLE_STATUS: TenantStatus = 'ACTIVE';

/** آیا این مستأجر اجازه‌ی عملیات نوشتنی دارد؟ */
export function isTenantWritable(tenant: Pick<Tenant, 'status'>): boolean {
  return tenant.status === WRITABLE_STATUS;
}

/**
 * قاعده‌ی «مستأجر غیرفعال نمی‌نویسد» را اعمال می‌کند.
 *
 * تابع خالص و بدون I/O است تا هم لایه‌ی HTTP (BE-008) و هم هر مصرف‌کننده‌ی
 * دیگری بتواند همین یک تعریف را صدا بزند. اگر هر جا نسخه‌ی دست‌ساز خودش
 * از این شرط نوشته شود، دیر یا زود یکی‌شان `SUSPENDED` را از قلم می‌اندازد.
 */
export function assertTenantWritable(tenant: Pick<Tenant, 'id' | 'status'>): void {
  if (!isTenantWritable(tenant)) {
    throw new TenantNotWritableError(tenant.id);
  }
}
