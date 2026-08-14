import { Inject, Injectable } from '@nestjs/common';
import { AssetDimensionsService } from '../ledger/asset-dimensions.service';
import { LedgerAccountsService } from '../ledger/ledger-accounts.service';
import { LedgerPostingService } from '../ledger/ledger-posting.service';
import { SettlementsService } from './settlements.service';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

export interface CreateRialSettlementInput {
  readonly tenantId: string;
  readonly partyId: string;
  readonly amountRial: bigint;
  readonly effectiveAt: Date;
  readonly createdBy: string;
}

export interface CreatedRialSettlement {
  readonly settlementId: string;
  readonly ledgerTransactionId: string;
}

/**
 * پرداخت ریالی مشتری روی طلب خودش — BE-045. طبق بخش ۵-۷
 * `docs/accounting-postings.md`: تک‌بعدی (`RIAL`)، بدون تبدیل واحد و بدون
 * اثر موجودی. `SettlementsService` مدل و append-only را می‌سازد؛ اینجا
 * فقط دو حساب لازم (صندوق و دریافتنی شخص) را می‌آورد و posting متوازن
 * می‌سازد.
 */
@Injectable()
export class RialSettlementsService {
  constructor(
    @Inject(SettlementsService) private readonly settlements: SettlementsService,
    @Inject(LedgerAccountsService) private readonly accounts: LedgerAccountsService,
    @Inject(LedgerPostingService) private readonly ledger: LedgerPostingService,
    @Inject(AssetDimensionsService) private readonly dimensions: AssetDimensionsService,
  ) {}

  async createInTransaction(
    transaction: TenantTransaction,
    input: CreateRialSettlementInput,
  ): Promise<CreatedRialSettlement> {
    const draft = await this.settlements.createDraftInTransaction(transaction, input);

    const [cash, receivable, rial] = await Promise.all([
      this.accounts.getRequiredSystemAccountInTransaction(transaction, input.tenantId, 'CASH'),
      this.accounts
        .ensurePartyAccountsInTransaction(transaction, {
          tenantId: input.tenantId,
          partyId: input.partyId,
        })
        .then((party) => party.receivable),
      this.dimensions.getRequiredBaseDimensionInTransaction(transaction, input.tenantId, 'RIAL'),
    ]);

    const finalized = await this.settlements.finalizeInTransaction(transaction, {
      tenantId: input.tenantId,
      settlementId: draft.id,
      effectiveAt: input.effectiveAt,
      createdBy: input.createdBy,
      lines: [
        {
          lineType: 'RIAL',
          dimensionId: rial.id,
          quantity: input.amountRial,
          sourceAccountId: receivable.id,
          destinationAccountId: cash.id,
        },
      ],
    });

    const posting = await this.ledger.postInTransaction(transaction, {
      source: { tenantId: input.tenantId, type: 'SETTLEMENT', id: finalized.settlement.id },
      effectiveAt: input.effectiveAt,
      description: `Rial settlement ${finalized.settlement.id}`,
      createdBy: input.createdBy,
      entries: [
        { accountId: cash.id, dimensionId: rial.id, quantity: input.amountRial },
        { accountId: receivable.id, dimensionId: rial.id, quantity: -input.amountRial },
      ],
    });

    return { settlementId: finalized.settlement.id, ledgerTransactionId: posting.transaction.id };
  }
}
