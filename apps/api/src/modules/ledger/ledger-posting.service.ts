import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../../platform/audit/audit.service';
import { DRIZZLE } from '../../platform/database/database.module';
import {
  assetDimensions,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactionSourceTypeEnum,
  ledgerTransactions,
} from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import {
  InactiveLedgerPostingAccountError,
  InactiveLedgerPostingDimensionError,
  InvalidLedgerPostingError,
  LedgerPostingAccountNotFoundError,
  LedgerPostingDimensionNotFoundError,
  UnbalancedLedgerPostingError,
} from './ledger-posting.errors';
import type { Database } from '../../platform/database/connect';
import type {
  LedgerEntry,
  LedgerEntryMetadata,
  LedgerTransaction,
  LedgerTransactionSourceType,
} from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** سندی که منشأ immutable posting را تعیین می‌کند. */
export interface LedgerPostingSource {
  readonly tenantId: string;
  readonly type: LedgerTransactionSourceType;
  readonly id: string;
}

/** یک entry signed: مثبت بدهکار و منفی بستانکار. */
export interface LedgerPostingEntryInput {
  readonly accountId: string;
  readonly dimensionId: string;
  readonly quantity: bigint;
  /** snapshotهای قفل‌شده و شناسه‌های ردیابی؛ پول/وزن در آن فقط string هستند. */
  readonly metadata?: LedgerEntryMetadata | undefined;
}

/** ورودی API داخلی LedgerPostingService. */
export interface LedgerPostingInput {
  readonly source: LedgerPostingSource;
  readonly effectiveAt: Date;
  readonly description: string;
  readonly entries: readonly LedgerPostingEntryInput[];
  readonly createdBy?: string | null | undefined;
}

export interface LedgerPostingResult {
  readonly transaction: LedgerTransaction;
  readonly entries: readonly LedgerEntry[];
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

/**
 * metadata امکانِ ذخیره‌ی نرخ/تنظیم قفل‌شده را دارد، اما مقدار عددی JavaScript
 * ندارد: JSON money/weight/count باید رشته‌ی صحیح بماند. `quantity` قطعی هم
 * فقط در ستون bigint است، نه در JSON.
 */
function isLedgerEntryMetadata(
  value: unknown,
  seen = new WeakSet<object>(),
): value is LedgerEntryMetadata {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true;
  }
  if (typeof value !== 'object' || value === undefined) {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.every((item) => isLedgerEntryMetadata(item, seen));
  }
  if (!isPlainRecord(value)) {
    return false;
  }

  return Object.values(value).every((item) => isLedgerEntryMetadata(item, seen));
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * تنها مسیر مجاز برای ساخت سربرگ و entryهای دفترکل.
 *
 * `postInTransaction` برای جریان‌هایی مانند موجودی افتتاحیه است که movement و
 * ledger باید در همان PostgreSQL transaction ثبت شوند. `post` فقط wrapperی برای
 * مورد مستقل است. هیچ API update/delete ارائه نمی‌شود؛ اصلاح بعدی سند جدید است.
 */
@Injectable()
export class LedgerPostingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async post(input: LedgerPostingInput): Promise<LedgerPostingResult> {
    return withTenantTransaction(this.db, input.source.tenantId, (transaction) =>
      this.postInTransaction(transaction, input),
    );
  }

  async postInTransaction(
    transaction: TenantTransaction,
    input: LedgerPostingInput,
  ): Promise<LedgerPostingResult> {
    this.validateStructure(input);
    this.validateBalance(input.entries);
    await this.validateTenantOwnership(transaction, input);

    const [createdTransaction] = await transaction
      .insert(ledgerTransactions)
      .values({
        tenantId: input.source.tenantId,
        sourceType: input.source.type,
        sourceId: input.source.id,
        effectiveAt: input.effectiveAt,
        description: input.description,
        createdBy: input.createdBy ?? null,
      })
      .returning();

    if (createdTransaction === undefined) {
      throw new Error('Ledger transaction was not created');
    }

    const createdEntries = await transaction
      .insert(ledgerEntries)
      .values(
        input.entries.map((entry) => ({
          tenantId: input.source.tenantId,
          transactionId: createdTransaction.id,
          accountId: entry.accountId,
          dimensionId: entry.dimensionId,
          quantity: entry.quantity,
          metadata: entry.metadata ?? {},
        })),
      )
      .returning();

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.source.tenantId,
      actorUserId: input.createdBy ?? null,
      action: 'LEDGER_POSTED',
      entityType: 'ledger_transaction',
      entityId: createdTransaction.id,
      afterData: {
        sourceType: createdTransaction.sourceType,
        sourceId: createdTransaction.sourceId,
        effectiveAt: createdTransaction.effectiveAt,
        entries: createdEntries.map((entry) => ({
          accountId: entry.accountId,
          dimensionId: entry.dimensionId,
          quantity: entry.quantity.toString(),
          metadata: entry.metadata,
        })),
      },
    });

    return { transaction: createdTransaction, entries: createdEntries };
  }

  private validateStructure(input: LedgerPostingInput): void {
    if (!isUuid(input.source.tenantId)) {
      throw new InvalidLedgerPostingError('source.tenantId must be a UUID');
    }
    if (!isUuid(input.source.id)) {
      throw new InvalidLedgerPostingError('source.id must be a UUID');
    }
    if (!ledgerTransactionSourceTypeEnum.enumValues.includes(input.source.type)) {
      throw new InvalidLedgerPostingError('source.type is not supported');
    }
    if (!(input.effectiveAt instanceof Date) || Number.isNaN(input.effectiveAt.getTime())) {
      throw new InvalidLedgerPostingError('effectiveAt must be a valid Date');
    }
    if (input.description.trim().length === 0) {
      throw new InvalidLedgerPostingError('description must not be blank');
    }
    if (input.entries.length === 0) {
      throw new InvalidLedgerPostingError('at least one ledger entry is required');
    }

    for (const entry of input.entries) {
      if (!isUuid(entry.accountId)) {
        throw new InvalidLedgerPostingError('entry.accountId must be a UUID');
      }
      if (!isUuid(entry.dimensionId)) {
        throw new InvalidLedgerPostingError('entry.dimensionId must be a UUID');
      }
      if (typeof entry.quantity !== 'bigint') {
        throw new InvalidLedgerPostingError('entry.quantity must be a bigint');
      }
      if (entry.quantity === 0n) {
        throw new InvalidLedgerPostingError('entry.quantity must not be zero');
      }
      if (entry.metadata !== undefined && !isLedgerEntryMetadata(entry.metadata)) {
        throw new InvalidLedgerPostingError(
          'entry.metadata may contain only null, boolean, string, arrays, and plain objects',
        );
      }
    }
  }

  private validateBalance(entries: readonly LedgerPostingEntryInput[]): void {
    const totalsByDimension = new Map<string, bigint>();

    for (const entry of entries) {
      totalsByDimension.set(
        entry.dimensionId,
        (totalsByDimension.get(entry.dimensionId) ?? 0n) + entry.quantity,
      );
    }

    for (const [dimensionId, total] of totalsByDimension) {
      if (total !== 0n) {
        throw new UnbalancedLedgerPostingError(dimensionId, total);
      }
    }
  }

  private async validateTenantOwnership(
    transaction: TenantTransaction,
    input: LedgerPostingInput,
  ): Promise<void> {
    const accountIds = [...new Set(input.entries.map((entry) => entry.accountId))];
    const dimensionIds = [...new Set(input.entries.map((entry) => entry.dimensionId))];
    const [accounts, dimensions] = await Promise.all([
      transaction
        .select({ id: ledgerAccounts.id, active: ledgerAccounts.active })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.tenantId, input.source.tenantId),
            inArray(ledgerAccounts.id, accountIds),
          ),
        ),
      transaction
        .select({ id: assetDimensions.id, active: assetDimensions.active })
        .from(assetDimensions)
        .where(
          and(
            eq(assetDimensions.tenantId, input.source.tenantId),
            inArray(assetDimensions.id, dimensionIds),
          ),
        ),
    ]);
    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    const dimensionsById = new Map(
      dimensions.map((dimension) => [dimension.id, dimension]),
    );

    for (const entry of input.entries) {
      const account = accountsById.get(entry.accountId);
      if (account === undefined) {
        throw new LedgerPostingAccountNotFoundError(entry.accountId);
      }
      if (!account.active) {
        throw new InactiveLedgerPostingAccountError(entry.accountId);
      }

      const dimension = dimensionsById.get(entry.dimensionId);
      if (dimension === undefined) {
        throw new LedgerPostingDimensionNotFoundError(entry.dimensionId);
      }
      if (!dimension.active) {
        throw new InactiveLedgerPostingDimensionError(entry.dimensionId);
      }
    }
  }
}
