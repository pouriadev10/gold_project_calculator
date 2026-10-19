import { describe, expect, it } from 'vitest';
import {
  TENANT_EXPORT_FORMAT,
  TENANT_EXPORT_SCHEMA_VERSION,
  tenantExportDocumentSchema,
  tenantExportSchema,
} from '../src/index.js';

const ID = '6b7c9d0e-0000-4000-8000-000000000001';
const SHA = 'a'.repeat(64);

function documentWith(rows: Record<string, unknown>[], rowCount = rows.length) {
  return {
    format: TENANT_EXPORT_FORMAT,
    schemaVersion: TENANT_EXPORT_SCHEMA_VERSION,
    exportId: ID,
    snapshotAt: '2026-10-19T11:20:00.000Z',
    requestedBy: ID,
    tenant: { id: ID, name: 'طلافروشی', slug: 'shop', status: 'ACTIVE', timezone: 'Asia/Tehran' },
    sections: { parties: { table: 'parties', rowCount, rows } },
  };
}

describe('tenantExportSchema', () => {
  const metadata = {
    id: ID,
    format: TENANT_EXPORT_FORMAT,
    schemaVersion: 1,
    snapshotAt: '2026-10-19T11:20:00.000Z',
    createdAt: '2026-10-19T11:20:01.000Z',
    requestedBy: ID,
    byteSize: 1024,
    sha256: SHA,
    rowCounts: { parties: 2 },
  };

  it('فراداده‌ی معتبر را می‌پذیرد', () => {
    expect(tenantExportSchema.parse(metadata)).toEqual(metadata);
  });

  it.each([
    ['قالب دیگر', { format: 'other-export' }],
    ['نسخه‌ی صفر', { schemaVersion: 0 }],
    ['sha256 با حروف بزرگ', { sha256: 'A'.repeat(64) }],
    ['sha256 کوتاه', { sha256: 'a'.repeat(63) }],
    ['تعداد منفی', { rowCounts: { parties: -1 } }],
  ])('رد می‌کند: %s', (_label, patch) => {
    expect(tenantExportSchema.safeParse({ ...metadata, ...patch }).success).toBe(false);
  });
});

describe('tenantExportDocumentSchema', () => {
  it('پوسته‌ی معتبر را با ردیف‌های آزاد می‌پذیرد', () => {
    const parsed = tenantExportDocumentSchema.parse(documentWith([{ id: ID, amountRial: '12500000' }]));

    expect(parsed.sections['parties']?.rows).toEqual([{ id: ID, amountRial: '12500000' }]);
  });

  it('rowCount ناهمخوان با تعداد ردیف را رد می‌کند', () => {
    const result = tenantExportDocumentSchema.safeParse(documentWith([{ id: ID }], 2));

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['sections', 'parties', 'rowCount']);
  });

  it('بدون format یا schemaVersion رد می‌شود', () => {
    const { format: _format, ...withoutFormat } = documentWith([]);
    const { schemaVersion: _version, ...withoutVersion } = documentWith([]);

    expect(tenantExportDocumentSchema.safeParse(withoutFormat).success).toBe(false);
    expect(tenantExportDocumentSchema.safeParse(withoutVersion).success).toBe(false);
  });
});
