import { describe, expect, it } from 'vitest';
import { sanitizeAuditData } from './audit.service';

describe('sanitizeAuditData', () => {
  it('secretها را در هر عمق پیش از ذخیره حذف می‌کند', () => {
    const sanitized = sanitizeAuditData({
      displayName: 'کاربر آزمون',
      password: 'never-store-this',
      nested: {
        accessToken: 'never-store-this-either',
        weightMg: 1250n,
        amountRial: 12500000,
      },
      rows: [{ refreshToken: 'hidden', roleCode: 'MANAGER' }],
    });

    expect(sanitized).toEqual({
      displayName: 'کاربر آزمون',
      nested: { weightMg: '1250', amountRial: '12500000' },
      rows: [{ roleCode: 'MANAGER' }],
    });
  });

  it('ساختار حلقوی را بدون throw و بدون نشت داده ثبت‌نشدنی می‌کند', () => {
    const circular: { readonly label: string; self?: unknown } = { label: 'safe' };
    circular.self = circular;

    expect(sanitizeAuditData(circular)).toEqual({ label: 'safe', self: '[circular]' });
  });
});
