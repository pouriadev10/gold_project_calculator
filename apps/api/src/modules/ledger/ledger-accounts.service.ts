import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../../platform/audit/audit.service';
import { DRIZZLE } from '../../platform/database/database.module';
import { ledgerAccounts, parties } from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import {
  LedgerAccountPartyNotFoundError,
  RequiredSystemLedgerAccountNotFoundError,
} from './ledger-accounts.errors';
import type { Database } from '../../platform/database/connect';
import type { LedgerAccount, LedgerAccountType } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

interface SystemLedgerAccountSeed {
  readonly code: string;
  readonly title: string;
  readonly accountType: LedgerAccountType;
  readonly systemKey: string;
}

/**
 * حساب‌های عمومیِ هر tenant. code و systemKey قراردادهای پایدار posting هستند؛
 * نام نمایشی در title نگه داشته می‌شود و عدد یا نرخ صنفی در کد ندارد.
 */
const INITIAL_SYSTEM_ACCOUNTS = [
  { code: 'ASSET:CASH', title: 'صندوق ریالی', accountType: 'ASSET', systemKey: 'CASH' },
  { code: 'ASSET:BANK', title: 'بانک', accountType: 'ASSET', systemKey: 'BANK' },
  {
    code: 'ASSET:INVENTORY_JEWELRY',
    title: 'موجودی مصنوعات',
    accountType: 'ASSET',
    systemKey: 'INVENTORY_JEWELRY',
  },
  {
    code: 'ASSET:INVENTORY_MELTED_GOLD',
    title: 'موجودی آبشده',
    accountType: 'ASSET',
    systemKey: 'INVENTORY_MELTED_GOLD',
  },
  {
    code: 'ASSET:ACCOUNTS_RECEIVABLE_CONTROL',
    title: 'کنترل حساب‌های دریافتنی اشخاص',
    accountType: 'ASSET',
    systemKey: 'ACCOUNTS_RECEIVABLE_CONTROL',
  },
  {
    code: 'LIABILITY:ACCOUNTS_PAYABLE_CONTROL',
    title: 'کنترل حساب‌های پرداختنی اشخاص',
    accountType: 'LIABILITY',
    systemKey: 'ACCOUNTS_PAYABLE_CONTROL',
  },
  {
    code: 'REVENUE:SALES',
    title: 'فروش',
    accountType: 'REVENUE',
    systemKey: 'SALES_REVENUE',
  },
  {
    code: 'REVENUE:WAGE',
    title: 'اجرت',
    accountType: 'REVENUE',
    systemKey: 'WAGE_REVENUE',
  },
  {
    code: 'EXPENSE:COGS_JEWELRY',
    title: 'بهای خروج مصنوعات',
    accountType: 'EXPENSE',
    systemKey: 'COGS_JEWELRY',
  },
  {
    code: 'EXPENSE:COGS_COIN',
    title: 'بهای خروج سکه',
    accountType: 'EXPENSE',
    systemKey: 'COGS_COIN',
  },
  {
    code: 'EXPENSE:PURCHASE_FROM_CONSUMER',
    title: 'خرید از مصرف‌کننده',
    accountType: 'EXPENSE',
    systemKey: 'PURCHASE_FROM_CONSUMER',
  },
  {
    code: 'LIABILITY:TAX_PAYABLE',
    title: 'مالیات پرداختنی',
    accountType: 'LIABILITY',
    systemKey: 'TAX_PAYABLE',
  },
  {
    code: 'EQUITY:OPENING',
    title: 'حساب افتتاحیه',
    accountType: 'EQUITY',
    systemKey: 'OPENING_EQUITY',
  },
  {
    code: 'EQUITY:PROFIT_LOSS',
    title: 'سود و زیان',
    accountType: 'EQUITY',
    systemKey: 'PROFIT_LOSS',
  },
  {
    code: 'CLEARING:SETTLEMENT_CONVERSION',
    title: 'تبدیل تسویه',
    accountType: 'CLEARING',
    systemKey: 'SETTLEMENT_CONVERSION_CLEARING',
  },
] as const satisfies readonly SystemLedgerAccountSeed[];

export interface SyncCoinInventoryAccountInput {
  readonly tenantId: string;
  readonly coinTypeId: string;
  readonly title: string;
  readonly active: boolean;
}

export interface EnsurePartyLedgerAccountsInput {
  readonly tenantId: string;
  readonly partyId: string;
}

export interface PartyLedgerAccounts {
  readonly receivable: LedgerAccount;
  readonly payable: LedgerAccount;
}

/** Chart of accounts and party subledgers. No update/delete API is exposed. */
@Injectable()
export class LedgerAccountsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async ensureInitialChartInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
  ): Promise<void> {
    for (const account of INITIAL_SYSTEM_ACCOUNTS) {
      const [created] = await transaction
        .insert(ledgerAccounts)
        .values({ tenantId, ...account, active: true })
        .onConflictDoNothing({ target: [ledgerAccounts.tenantId, ledgerAccounts.systemKey] })
        .returning();

      if (created !== undefined) {
        await this.recordCreatedAudit(transaction, tenantId, created);
      }
    }
  }

  /** هر coin type دقیقاً یک حساب موجودی مستقل و count-only دارد. */
  async syncCoinInventoryAccountInTransaction(
    transaction: TenantTransaction,
    input: SyncCoinInventoryAccountInput,
  ): Promise<LedgerAccount> {
    const systemKey = `INVENTORY_COIN:${input.coinTypeId}`;
    const [account] = await transaction
      .insert(ledgerAccounts)
      .values({
        tenantId: input.tenantId,
        code: `ASSET:${systemKey}`,
        title: `موجودی ${input.title}`,
        accountType: 'ASSET',
        systemKey,
        active: input.active,
      })
      .onConflictDoUpdate({
        target: [ledgerAccounts.tenantId, ledgerAccounts.systemKey],
        // account identity ثابت است؛ فقط عنوان و active با نسخه‌ی فعلی سکه sync می‌شوند.
        set: { title: `موجودی ${input.title}`, active: input.active },
      })
      .returning();

    const resolved = account!;
    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: null,
      action: 'LEDGER_COIN_ACCOUNT_SYNCED',
      entityType: 'ledger_account',
      entityId: resolved.id,
      afterData: {
        code: resolved.code,
        accountType: resolved.accountType,
        systemKey: resolved.systemKey,
        active: resolved.active,
      },
    });

    return resolved;
  }

  async ensurePartyAccounts(input: EnsurePartyLedgerAccountsInput): Promise<PartyLedgerAccounts> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.ensurePartyAccountsInTransaction(transaction, input),
    );
  }

  /**
   * برای هر شخص حداکثر یک حساب دریافتنی و یک حساب پرداختنی ساخته می‌شود.
   * این دو system key ندارند؛ هویت آن‌ها `(tenant, party, accountType)` است.
   */
  async ensurePartyAccountsInTransaction(
    transaction: TenantTransaction,
    input: EnsurePartyLedgerAccountsInput,
  ): Promise<PartyLedgerAccounts> {
    const [party] = await transaction
      .select({ id: parties.id, displayName: parties.displayName, status: parties.status })
      .from(parties)
      .where(and(eq(parties.tenantId, input.tenantId), eq(parties.id, input.partyId)))
      .limit(1);

    if (party === undefined) {
      throw new LedgerAccountPartyNotFoundError(input.partyId);
    }

    const active = party.status === 'ACTIVE';
    const receivable = await this.upsertPartyAccountInTransaction(
      transaction,
      input.tenantId,
      party.id,
      party.displayName,
      'ASSET',
      active,
    );
    const payable = await this.upsertPartyAccountInTransaction(
      transaction,
      input.tenantId,
      party.id,
      party.displayName,
      'LIABILITY',
      active,
    );

    return { receivable, payable };
  }

  async getRequiredSystemAccountInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    systemKey: string,
  ): Promise<LedgerAccount> {
    const [account] = await transaction
      .select()
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.tenantId, tenantId),
          eq(ledgerAccounts.systemKey, systemKey),
        ),
      )
      .limit(1);

    if (account === undefined) {
      throw new RequiredSystemLedgerAccountNotFoundError(tenantId, systemKey);
    }

    return account;
  }

  private async upsertPartyAccountInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    partyId: string,
    partyName: string,
    accountType: 'ASSET' | 'LIABILITY',
    active: boolean,
  ): Promise<LedgerAccount> {
    const key = accountType === 'ASSET' ? 'PARTY_RECEIVABLE' : 'PARTY_PAYABLE';
    const titlePrefix = accountType === 'ASSET' ? 'حساب دریافتنی' : 'حساب پرداختنی';
    const [account] = await transaction
      .insert(ledgerAccounts)
      .values({
        tenantId,
        partyId,
        code: `${key}:${partyId}`,
        title: `${titlePrefix} ${partyName}`,
        accountType,
        active,
      })
      .onConflictDoUpdate({
        target: [ledgerAccounts.tenantId, ledgerAccounts.partyId, ledgerAccounts.accountType],
        // party identity و account type تغییر نمی‌کنند؛ نام و انتخاب‌پذیری sync می‌شوند.
        set: { title: `${titlePrefix} ${partyName}`, active },
      })
      .returning();

    const resolved = account!;
    await this.audit.recordInTransaction(transaction, {
      tenantId,
      actorUserId: null,
      action: 'LEDGER_PARTY_ACCOUNT_SYNCED',
      entityType: 'ledger_account',
      entityId: resolved.id,
      afterData: {
        partyId,
        accountType: resolved.accountType,
        active: resolved.active,
      },
    });

    return resolved;
  }

  private async recordCreatedAudit(
    transaction: TenantTransaction,
    tenantId: string,
    account: LedgerAccount,
  ): Promise<void> {
    await this.audit.recordInTransaction(transaction, {
      tenantId,
      actorUserId: null,
      action: 'LEDGER_SYSTEM_ACCOUNT_CREATED',
      entityType: 'ledger_account',
      entityId: account.id,
      afterData: {
        code: account.code,
        accountType: account.accountType,
        systemKey: account.systemKey,
      },
    });
  }
}
