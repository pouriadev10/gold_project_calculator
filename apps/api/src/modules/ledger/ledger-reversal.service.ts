import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../../platform/audit/audit.service';
import { DRIZZLE } from '../../platform/database/database.module';
import { getPostgresConstraintName, isUniqueViolation } from '../../platform/database/pg-errors';
import { ledgerEntries, ledgerTransactions } from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { LedgerPostingService } from './ledger-posting.service';
import { LedgerTransactionNotFoundError } from './ledger-reversal.errors';
import type { Database } from '../../platform/database/connect';
import type { LedgerEntry, LedgerTransaction } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

/**
 * همان محدودیت یکتاییِ `(tenant_id, source_type, source_id)` که BE-032
 * برای دفتر کل ساخت. reversal یک source_type تازه دارد و source_id آن
 * همان شناسه‌ی تراکنش اصلی است، پس این محدودیت به‌طور طبیعی از دو بار
 * reverse شدنِ یک تراکنش جلوگیری می‌کند — بدون هیچ constraint جدید.
 */
const REVERSAL_SOURCE_UNIQUE_CONSTRAINT = 'ledger_transactions_tenant_source_unique';

export interface ReverseLedgerTransactionInput {
  readonly tenantId: string;
  readonly transactionId: string;
  readonly effectiveAt: Date;
  readonly description: string;
  readonly createdBy?: string | null | undefined;
}

export interface ReverseLedgerTransactionResult {
  readonly reversalTransaction: LedgerTransaction;
  readonly entries: readonly LedgerEntry[];
  /** true یعنی این تراکنش از قبل reverse شده بود و همان نتیجه‌ی قبلی برگشت. */
  readonly alreadyReversed: boolean;
}

/**
 * اصلاح حسابداری بدون تغییر تاریخچه — BE-036.
 *
 * تراکنش اصلی هرگز update یا delete نمی‌شود؛ فقط یک سربرگ تازه با
 * entryهای دقیقاً معکوس (`-quantity` روی همان حساب و همان بُعد) از راه
 * `LedgerPostingService` — تنها مسیر مجاز نوشتن دفتر کل — ثبت می‌شود.
 *
 * ## چرا insert داخل SAVEPOINT انجام می‌شود
 *
 * تلاش دوم برای reverse کردن همان تراکنش به یکتاییِ منبع می‌خورد. بدون
 * SAVEPOINT، آن خطای PostgreSQL کل `TenantTransaction` فراخوان را
 * «aborted» می‌کند و حتی خواندنِ reversal موجود در همان متد هم شکست
 * می‌خورد — دقیقاً شرط رقابتیِ «چک کن بعد insert کن»ی که BE-007 هم با آن
 * مواجه شد، با یک لایه‌ی عارضه‌ی بیشتر. SAVEPOINT خطای insert را داخل
 * خودش نگه می‌دارد؛ `TenantTransaction` بیرونی برای ادامه‌ی کار سالم
 * می‌ماند.
 */
@Injectable()
export class LedgerReversalService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(LedgerPostingService) private readonly posting: LedgerPostingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async reverse(input: ReverseLedgerTransactionInput): Promise<ReverseLedgerTransactionResult> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.reverseInTransaction(transaction, input),
    );
  }

  async reverseInTransaction(
    transaction: TenantTransaction,
    input: ReverseLedgerTransactionInput,
  ): Promise<ReverseLedgerTransactionResult> {
    const [original] = await transaction
      .select()
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.tenantId, input.tenantId),
          eq(ledgerTransactions.id, input.transactionId),
        ),
      )
      .limit(1);

    if (original === undefined) {
      throw new LedgerTransactionNotFoundError(input.transactionId);
    }

    const originalEntries = await transaction
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.transactionId, original.id));

    try {
      const posted = await transaction.transaction((savepoint) =>
        this.posting.postInTransaction(savepoint, {
          source: { tenantId: input.tenantId, type: 'LEDGER_REVERSAL', id: original.id },
          effectiveAt: input.effectiveAt,
          description: input.description,
          createdBy: input.createdBy ?? null,
          reversalOfTransactionId: original.id,
          entries: originalEntries.map((entry) => ({
            accountId: entry.accountId,
            dimensionId: entry.dimensionId,
            quantity: -entry.quantity,
            metadata: entry.metadata,
          })),
        }),
      );

      await this.audit.recordInTransaction(transaction, {
        tenantId: input.tenantId,
        actorUserId: input.createdBy ?? null,
        action: 'LEDGER_REVERSED',
        entityType: 'ledger_transaction',
        entityId: posted.transaction.id,
        afterData: { reversalOfTransactionId: original.id },
      });

      return {
        reversalTransaction: posted.transaction,
        entries: posted.entries,
        alreadyReversed: false,
      };
    } catch (error) {
      if (
        isUniqueViolation(error) &&
        getPostgresConstraintName(error) === REVERSAL_SOURCE_UNIQUE_CONSTRAINT
      ) {
        return this.loadExistingReversal(transaction, input.tenantId, original.id);
      }
      throw error;
    }
  }

  private async loadExistingReversal(
    transaction: TenantTransaction,
    tenantId: string,
    originalTransactionId: string,
  ): Promise<ReverseLedgerTransactionResult> {
    const [existing] = await transaction
      .select()
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.tenantId, tenantId),
          eq(ledgerTransactions.sourceType, 'LEDGER_REVERSAL'),
          eq(ledgerTransactions.sourceId, originalTransactionId),
        ),
      )
      .limit(1);

    if (existing === undefined) {
      throw new Error('Reversal source conflicted but no existing reversal row was found');
    }

    const existingEntries = await transaction
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.transactionId, existing.id));

    return { reversalTransaction: existing, entries: existingEntries, alreadyReversed: true };
  }
}
