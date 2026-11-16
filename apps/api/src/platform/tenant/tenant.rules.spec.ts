import { describe, expect, it } from 'vitest';
import { TenantNotWritableError } from './tenant.errors';
import {
  assertTenantWritable,
  canOpenSession,
  isTenantWritable,
  isWriteAllowedWhileSuspended,
} from './tenant.rules';

const TENANT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('isTenantWritable', () => {
  it('مستأجر فعال اجازه‌ی نوشتن دارد', () => {
    expect(isTenantWritable({ status: 'ACTIVE' })).toBe(true);
  });

  it('مستأجر معلق اجازه‌ی نوشتن ندارد', () => {
    expect(isTenantWritable({ status: 'SUSPENDED' })).toBe(false);
  });
});

describe('assertTenantWritable', () => {
  it('برای مستأجر فعال خطا نمی‌دهد', () => {
    expect(() => assertTenantWritable({ id: TENANT_ID, status: 'ACTIVE' })).not.toThrow();
  });

  it('برای مستأجر معلق TenantNotWritableError پرتاب می‌کند', () => {
    expect(() => assertTenantWritable({ id: TENANT_ID, status: 'SUSPENDED' })).toThrow(
      TenantNotWritableError,
    );
  });

  it('خطا شناسه‌ی مستأجر را برای ردیابی نگه می‌دارد', () => {
    try {
      assertTenantWritable({ id: TENANT_ID, status: 'SUSPENDED' });
      expect.unreachable('باید خطا می‌داد');
    } catch (error) {
      expect((error as TenantNotWritableError).tenantId).toBe(TENANT_ID);
    }
  });
});

describe('isWriteAllowedWhileSuspended — D-03', () => {
  it('فقط ساخت خروجی کامل مجاز است', () => {
    expect(isWriteAllowedWhileSuspended('POST', '/platform/exports/full')).toBe(true);
  });

  it.each([
    ['POST', '/parties'],
    ['POST', '/sales/invoices/jewelry'],
    ['PUT', '/platform/exports/full'],
    ['DELETE', '/platform/exports/full'],
    ['POST', '/platform/exports/full/extra'],
    ['POST', '/platform/exports'],
  ])('%s %s رد می‌شود', (method, path) => {
    expect(isWriteAllowedWhileSuspended(method, path)).toBe(false);
  });
});

describe('canOpenSession — D-03', () => {
  it.each(['OWNER', 'MANAGER', 'CASHIER'] as const)('مستأجر فعال: %s نشست می‌سازد', (role) => {
    expect(canOpenSession({ status: 'ACTIVE' }, role)).toBe(true);
  });

  it('مستأجر معلق: فقط OWNER نشست می‌سازد', () => {
    expect(canOpenSession({ status: 'SUSPENDED' }, 'OWNER')).toBe(true);
    expect(canOpenSession({ status: 'SUSPENDED' }, 'MANAGER')).toBe(false);
    expect(canOpenSession({ status: 'SUSPENDED' }, 'CASHIER')).toBe(false);
  });
});
