import { TenantNotWritableError } from './tenant.errors';
import type { RoleCode, Tenant, TenantStatus } from '../database/schema';

/** تنها وضعیتی که اجازه‌ی نوشتن می‌دهد. */
const WRITABLE_STATUS: TenantStatus = 'ACTIVE';

/**
 * D-03: تنها نوشتن‌هایی که مستأجر معلق مجاز است، به شکل `METHOD /path`.
 *
 * کسب‌وکاری که معلق شده یا دارد می‌رود باید بتواند داده‌اش را بگیرد. خروجی کامل هیچ سند
 * مالی نمی‌سازد و فقط یک ردیف `tenant_exports` می‌نویسد. تطبیق دقیق است، نه پیشوندی.
 */
const SUSPENDED_WRITE_ALLOWLIST: ReadonlySet<string> = new Set(['POST /platform/exports/full']);

/** آیا این مستأجر اجازه‌ی عملیات نوشتنی دارد؟ */
export function isTenantWritable(tenant: Pick<Tenant, 'status'>): boolean {
  return tenant.status === WRITABLE_STATUS;
}

/** D-03: آیا این نوشتن برای مستأجر معلق هم مجاز است؟ */
export function isWriteAllowedWhileSuspended(method: string, path: string): boolean {
  return SUSPENDED_WRITE_ALLOWLIST.has(`${method} ${path}`);
}

/**
 * D-03: آیا این عضویت می‌تواند نشست بسازد یا تمدید کند؟
 *
 * مستأجر فعال: همه‌ی نقش‌ها. مستأجر معلق: فقط OWNER، تا خروجی کامل داده را بگیرد. نشست او
 * عملاً فقط‌خواندنی است، چون میان‌افزار مستأجر جز `SUSPENDED_WRITE_ALLOWLIST` هر نوشتنی را رد
 * می‌کند. مدیر و صندوقدار همچنان نشست نمی‌گیرند (BE-011).
 */
export function canOpenSession(tenant: Pick<Tenant, 'status'>, role: RoleCode): boolean {
  return isTenantWritable(tenant) || role === 'OWNER';
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
