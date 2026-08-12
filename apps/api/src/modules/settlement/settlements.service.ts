import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../../platform/audit/audit.service';
import { DRIZZLE } from '../../platform/database/database.module';
import { settlementLines, settlements } from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { PartiesService, PartyNotFoundError } from '../parties/parties.service';
import {
  InvalidSettlementFinalizeInputError,
  SettlementNotDraftError,
  SettlementNotFoundError,
  SettlementRequiresLinesError,
} from './settlements.errors';
import type { Database } from '../../platform/database/connect';
import type {
  Settlement,
  SettlementLine,
  SettlementLineSnapshotValue,
  SettlementLineType,
} from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

export interface CreateDraftSettlementInput {
  readonly tenantId: string;
  readonly partyId: string;
  readonly createdBy: string;
}

export interface FinalizeSettlementLineInput {
  readonly lineType: SettlementLineType;
  readonly dimensionId: string;
  readonly quantity: bigint;
  readonly sourceAccountId: string;
  readonly destinationAccountId: string;
  readonly lockedQuoteId?: string | null | undefined;
  readonly lockedQuoteAmountRial?: bigint | null | undefined;
  readonly lockedConversionSnapshot?: SettlementLineSnapshotValue | undefined;
}

export interface FinalizeSettlementInput {
  readonly tenantId: string;
  readonly settlementId: string;
  readonly effectiveAt: Date;
  readonly lines: readonly FinalizeSettlementLineInput[];
  readonly createdBy: string;
}

export interface FinalizedSettlement {
  readonly settlement: Settlement;
  readonly lines: readonly SettlementLine[];
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function isSnapshotValue(
  value: unknown,
  seen = new WeakSet<object>(),
): value is SettlementLineSnapshotValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true;
  }
  if (typeof value !== 'object' || value === undefined || seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.every((item) => isSnapshotValue(item, seen));
  }
  return isPlainRecord(value) && Object.values(value).every((item) => isSnapshotValue(item, seen));
}

function assertFinalizeInput(input: FinalizeSettlementInput): void {
  for (const line of input.lines) {
    if (line.quantity <= 0n) {
      throw new InvalidSettlementFinalizeInputError('Settlement line quantity must be positive');
    }
    if (line.sourceAccountId === line.destinationAccountId) {
      throw new InvalidSettlementFinalizeInputError(
        'Settlement line source and destination accounts must differ',
      );
    }
    if (
      line.lockedConversionSnapshot !== undefined &&
      !isSnapshotValue(line.lockedConversionSnapshot)
    ) {
      throw new InvalidSettlementFinalizeInputError(
        'Settlement line conversion snapshot must not contain number values',
      );
    }
  }
}

/**
 * مدل و چرخه‌ی عمر تسویه‌ی چندواحدی — BE-044.
 *
 * مثل `SalesInvoicesService` (BE-039) این سرویس posting دفتر کل یا حرکت
 * موجودی نمی‌سازد — آن مسیر کار BE-045 تا BE-048 است، هر کدام روی نوع
 * ابزار پرداخت خودش. اینجا فقط پیش‌نویس و finalize با ردیف‌های
 * append-only. نرخ/تبدیل قفل‌شده‌ی هر ردیف را فراخوان (نهایتاً
 * BE-045..048) حساب و پاس می‌دهد؛ این سرویس هرگز خودش مظنه‌ی امروز را
 * نمی‌خواند.
 */
@Injectable()
export class SettlementsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PartiesService) private readonly parties: PartiesService,
  ) {}

  async createDraft(input: CreateDraftSettlementInput): Promise<Settlement> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.createDraftInTransaction(transaction, input),
    );
  }

  async createDraftInTransaction(
    transaction: TenantTransaction,
    input: CreateDraftSettlementInput,
  ): Promise<Settlement> {
    const party = await this.parties.findActiveInTransaction(
      transaction,
      input.tenantId,
      input.partyId,
    );
    if (party === undefined) {
      throw new PartyNotFoundError();
    }

    const [created] = await transaction
      .insert(settlements)
      .values({ tenantId: input.tenantId, partyId: input.partyId, createdBy: input.createdBy })
      .returning();
    const settlement = created!;

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: input.createdBy,
      action: 'SETTLEMENT_DRAFT_CREATED',
      entityType: 'settlement',
      entityId: settlement.id,
      afterData: { partyId: input.partyId, status: settlement.status },
    });

    return settlement;
  }

  async finalize(input: FinalizeSettlementInput): Promise<FinalizedSettlement> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.finalizeInTransaction(transaction, input),
    );
  }

  /**
   * پیش‌نویس را نهایی می‌کند: ردیف‌های append-only درج می‌شوند و سربرگ
   * قفل می‌شود. این متد فقط روی تسویه‌ی `DRAFT` کار می‌کند و بعد از
   * موفقیت status به `FINALIZED` می‌رود — دیگر روی همان تسویه اجرا
   * نمی‌شود؛ اصلاح یعنی تسویه‌ی جدید.
   */
  async finalizeInTransaction(
    transaction: TenantTransaction,
    input: FinalizeSettlementInput,
  ): Promise<FinalizedSettlement> {
    assertFinalizeInput(input);
    if (input.lines.length === 0) {
      throw new SettlementRequiresLinesError();
    }

    const [settlement] = await transaction
      .select()
      .from(settlements)
      .where(and(eq(settlements.tenantId, input.tenantId), eq(settlements.id, input.settlementId)))
      .limit(1);
    if (settlement === undefined) {
      throw new SettlementNotFoundError(input.settlementId);
    }
    if (settlement.status !== 'DRAFT') {
      throw new SettlementNotDraftError(input.settlementId);
    }

    const [updated] = await transaction
      .update(settlements)
      .set({ status: 'FINALIZED', effectiveAt: input.effectiveAt, finalizedAt: input.effectiveAt })
      .where(eq(settlements.id, settlement.id))
      .returning();

    const createdLines = await transaction
      .insert(settlementLines)
      .values(
        input.lines.map((line) => ({
          tenantId: input.tenantId,
          settlementId: settlement.id,
          lineType: line.lineType,
          dimensionId: line.dimensionId,
          quantity: line.quantity,
          sourceAccountId: line.sourceAccountId,
          destinationAccountId: line.destinationAccountId,
          lockedQuoteId: line.lockedQuoteId ?? null,
          lockedQuoteAmountRial: line.lockedQuoteAmountRial ?? null,
          lockedConversionSnapshot: line.lockedConversionSnapshot ?? null,
        })),
      )
      .returning();

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: input.createdBy,
      action: 'SETTLEMENT_FINALIZED',
      entityType: 'settlement',
      entityId: settlement.id,
      afterData: { lineCount: createdLines.length.toString() },
    });

    return { settlement: updated!, lines: createdLines };
  }
}
