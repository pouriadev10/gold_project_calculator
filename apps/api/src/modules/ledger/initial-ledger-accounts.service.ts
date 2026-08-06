import { Inject, Injectable } from '@nestjs/common';
import { LedgerAccountsService } from './ledger-accounts.service';
import type {
  TenantInitializationInput,
  TenantInitializer,
} from '../../platform/tenant/tenant-initializer';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

/** Chart پایه پیش از seed شدن coin typeها ساخته می‌شود؛ هر coin حساب خود را همان‌جا می‌گیرد. */
@Injectable()
export class InitialLedgerAccountsService implements TenantInitializer {
  constructor(@Inject(LedgerAccountsService) private readonly accounts: LedgerAccountsService) {}

  async initializeInTransaction(
    transaction: TenantTransaction,
    input: TenantInitializationInput,
  ): Promise<void> {
    await this.accounts.ensureInitialChartInTransaction(transaction, input.tenantId);
  }
}
