import { describe, expect, it } from 'vitest';
import { TenantNotWritableError } from './tenant.errors';
import { assertTenantWritable, isTenantWritable } from './tenant.rules';

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
