import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { TENANT_EXPORT_FORMAT, TENANT_EXPORT_SCHEMA_VERSION } from '@gold/contracts';
import { AuditService } from '../audit/audit.service';
import { DRIZZLE } from '../database/database.module';
import { tenantExports } from '../database/schema';
import { configureTenantTransaction, withTenantTransaction } from '../database/tenant-transaction';
import { TenantService } from '../tenant/tenant.service';
import { TenantExportNotFoundError } from './tenant-exports.errors';
import { TENANT_EXPORT_SECTIONS } from './tenant-export.sections';
import type { TenantExport as TenantExportMetadata, TenantExportDocument } from '@gold/contracts';
import type { Database } from '../database/connect';
import type { TenantExport, TenantExportRowCounts } from '../database/schema';
import type { TenantTransaction } from '../database/tenant-transaction';
import type { ExportRow } from './tenant-export.sections';

export interface CreateTenantExportInput {
  readonly tenantId: string;
  readonly requestedBy: string;
}

interface Snapshot {
  readonly snapshotAt: Date;
  readonly sections: readonly { readonly name: string; readonly table: string; readonly rows: ExportRow[] }[];
}

/** قرارداد JSON پروژه: پول، وزن و تعداد `bigint` روی سیم رشته‌اند. */
function exportReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * خروجی کامل داده‌ی مستأجر — BE-069.
 *
 * همه‌ی خواندن‌ها در **یک** تراکنش `REPEATABLE READ READ ONLY` با نقش
 * `gold_app` انجام می‌شود:
 *
 * - یک snapshot: فروشی که وسط خروجی ثبت شود یا کامل در فایل است یا اصلاً
 *   نیست — هرگز سربرگ دفتر کل بدون entryهایش.
 * - RLS: حتی اگر یک بخش فیلتر `tenant_id` را فراموش کند، PostgreSQL ردیف
 *   مستأجر دیگر را برنمی‌گرداند.
 *
 * تولید هم‌زمان با درخواست است، نه در صف: هیچ عملیات مالی‌ای اینجا نیست و
 * داده‌ی یک مستأجر فاز ۱ در چند ثانیه خوانده می‌شود (BE-066: مستأجر یک‌ساله
 * حدود ۲۰ هزار ردیف). فایل در `tenant_exports` می‌ماند تا هر دانلود همان
 * بایت‌ها باشد.
 */
@Injectable()
export class TenantExportsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(TenantService) private readonly tenants: TenantService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * خروجی می‌سازد و داخل `transaction` (تراکنش idempotency) ذخیره می‌کند.
   * snapshot روی اتصال جداگانه خوانده می‌شود، چون سطح ایزوله‌سازی تراکنشی که
   * پیش‌تر query اجرا کرده دیگر قابل تغییر نیست.
   */
  async createInTransaction(
    transaction: TenantTransaction,
    input: CreateTenantExportInput,
  ): Promise<TenantExportMetadata> {
    const tenant = await this.tenants.findById(input.tenantId);

    if (tenant === undefined) {
      throw new Error(`tenant ${input.tenantId} disappeared during export`);
    }

    const exportId = randomUUID();
    const snapshot = await this.readSnapshot(input.tenantId);
    const document: TenantExportDocument = {
      format: TENANT_EXPORT_FORMAT,
      schemaVersion: TENANT_EXPORT_SCHEMA_VERSION,
      exportId,
      snapshotAt: snapshot.snapshotAt.toISOString(),
      requestedBy: input.requestedBy,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        timezone: tenant.timezone,
      },
      sections: Object.fromEntries(
        snapshot.sections.map((section) => [
          section.name,
          { table: section.table, rowCount: section.rows.length, rows: section.rows },
        ]),
      ),
    };
    const content = JSON.stringify(document, exportReplacer);
    const byteSize = Buffer.byteLength(content, 'utf8');
    const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');
    const rowCounts: TenantExportRowCounts = Object.fromEntries(
      snapshot.sections.map((section) => [section.name, section.rows.length]),
    );

    const [created] = await transaction
      .insert(tenantExports)
      .values({
        id: exportId,
        tenantId: input.tenantId,
        requestedBy: input.requestedBy,
        schemaVersion: TENANT_EXPORT_SCHEMA_VERSION,
        snapshotAt: snapshot.snapshotAt,
        content,
        contentSha256: sha256,
        byteSize: BigInt(byteSize),
        rowCounts,
      })
      .returning({ createdAt: tenantExports.createdAt });

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: input.requestedBy,
      action: 'TENANT_EXPORT_CREATED',
      entityType: 'tenant_export',
      entityId: exportId,
      afterData: { schemaVersion: TENANT_EXPORT_SCHEMA_VERSION, snapshotAt: snapshot.snapshotAt, sha256, rowCounts },
    });

    return {
      id: exportId,
      format: TENANT_EXPORT_FORMAT,
      schemaVersion: TENANT_EXPORT_SCHEMA_VERSION,
      snapshotAt: snapshot.snapshotAt.toISOString(),
      createdAt: created!.createdAt.toISOString(),
      requestedBy: input.requestedBy,
      byteSize,
      sha256,
      rowCounts,
    };
  }

  /** فایل ذخیره‌شده؛ شناسه‌ی مستأجر دیگر همان «پیدا نشد» است که UUID تصادفی. */
  async findForDownload(tenantId: string, exportId: string): Promise<TenantExport> {
    const [found] = await withTenantTransaction(this.db, tenantId, (transaction) =>
      transaction
        .select()
        .from(tenantExports)
        .where(and(eq(tenantExports.tenantId, tenantId), eq(tenantExports.id, exportId))),
    );

    if (found === undefined) {
      throw new TenantExportNotFoundError(exportId);
    }

    return found;
  }

  async recordDownload(tenantId: string, exportId: string, actorUserId: string): Promise<void> {
    await this.audit.record({
      tenantId,
      actorUserId,
      action: 'TENANT_EXPORT_DOWNLOADED',
      entityType: 'tenant_export',
      entityId: exportId,
    });
  }

  private async readSnapshot(tenantId: string): Promise<Snapshot> {
    return this.db.transaction(
      async (transaction) => {
        await configureTenantTransaction(transaction, tenantId);
        // `now()` زمان شروع تراکنش است — همان لحظه‌ای که snapshot از آن خوانده می‌شود.
        const {
          rows: [clock],
        } = await transaction.execute<{ snapshot_at: Date | string }>(sql`SELECT now() AS snapshot_at`);
        const sections = [];

        for (const section of TENANT_EXPORT_SECTIONS) {
          sections.push({
            name: section.name,
            table: section.table,
            rows: await section.read(transaction, tenantId),
          });
        }

        return { snapshotAt: new Date(clock!.snapshot_at), sections };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
