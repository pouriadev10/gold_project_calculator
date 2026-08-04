import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE } from '../database/database.module';
import { auditLogs } from '../database/schema';
import { withTenantTransaction } from '../database/tenant-transaction';
import type { Database } from '../database/connect';
import type { AuditData, AuditLog } from '../database/schema';
import type { TenantTransaction } from '../database/tenant-transaction';

/** نام‌های حساس به‌صورت case-insensitive حذف می‌شوند، حتی اگر در object تو در تو باشند. */
const SENSITIVE_KEY_PATTERN =
  /(?:api[-_]?key|authorization|cookie|credential|password|secret|token)/i;

const CIRCULAR_VALUE = '[circular]';
const UNSUPPORTED_VALUE = '[unsupported]';

export interface CreateAuditLogInput {
  readonly tenantId: string;
  readonly actorUserId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly beforeData?: unknown;
  readonly afterData?: unknown;
  readonly metadata?: unknown;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

/**
 * پیش از رسیدن داده به PostgreSQL، secretها را در هر عمق حذف می‌کند. bigint به
 * رشته تبدیل می‌شود تا logging هرگز با خطای JSON.stringify متوقف نشود.
 */
export function sanitizeAuditData(value: unknown, seen = new WeakSet<object>()): AuditData | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : UNSUPPORTED_VALUE;
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    return UNSUPPORTED_VALUE;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value !== 'object') {
    return UNSUPPORTED_VALUE;
  }
  if (seen.has(value)) {
    return CIRCULAR_VALUE;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditData(item, seen) ?? null);
  }
  if (!isPlainRecord(value)) {
    return UNSUPPORTED_VALUE;
  }

  const sanitized: Record<string, AuditData> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }

    const safeValue = sanitizeAuditData(item, seen);
    if (safeValue !== undefined) {
      sanitized[key] = safeValue;
    }
  }

  return sanitized;
}

/**
 * ثبت append-only رویدادهای حساس. service هیچ متد update/delete ندارد و خود
 * جدول نیز با trigger دیتابیس در برابر آن دو عملیات محافظت می‌شود.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async record(input: CreateAuditLogInput): Promise<AuditLog> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.recordInTransaction(transaction, input),
    );
  }

  async recordInTransaction(
    transaction: TenantTransaction,
    input: CreateAuditLogInput,
  ): Promise<AuditLog> {
    const [created] = await transaction
      .insert(auditLogs)
      .values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeData: sanitizeAuditData(input.beforeData),
        afterData: sanitizeAuditData(input.afterData),
        metadata: sanitizeAuditData(input.metadata) ?? {},
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      })
      .returning();

    return created!;
  }
}
