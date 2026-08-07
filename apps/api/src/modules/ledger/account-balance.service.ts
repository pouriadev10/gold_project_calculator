import { Inject, Injectable } from '@nestjs/common';
import { toSafeNumber } from '@gold/core-calc';
import { and, eq, lte } from 'drizzle-orm';
import { DRIZZLE } from '../../platform/database/database.module';
import {
  assetDimensions,
  coinTypes,
  ledgerAccounts,
  ledgerEntries,
  ledgerTransactions,
} from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { LedgerAccountNotFoundError } from './account-balance.errors';
import type { Database } from '../../platform/database/connect';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

/**
 * مانده‌ی برداریِ یک حساب — BE-037.
 *
 * `rial`/`gold`/`silver` رشته‌اند چون از `bigint` می‌آیند (قاعده‌ی ۲-۱).
 * `coins` عدد معمولی جاوااسکریپت است، نه رشته: تعداد سکه در دیتابیس
 * `integer` است، نه `bigint` (همان قاعده‌ی ۲-۱)، پس همیشه در محدوده‌ی امن
 * `Number` می‌گنجد. تبدیل با `toSafeNumber` از `core-calc` انجام می‌شود —
 * تنها نقطه‌ی مجاز `bigint → number` در کل کدبیس — که اگر جایی این فرض
 * نقض شد، بی‌صدا گرد نمی‌شود، خطا می‌دهد.
 *
 * فقط بُعدهایی که این حساب واقعاً در آن‌ها entry دارد در خروجی می‌آیند؛
 * نبودِ entry یعنی نبودِ کلید، نه صفرِ پیش‌فرض — یک حساب که هرگز طلا
 * ندیده «gold: "0"» نمی‌گیرد.
 */
export interface AccountBalances {
  readonly rial?: string;
  readonly gold?: string;
  readonly silver?: string;
  readonly coins: Readonly<Record<string, number>>;
}

@Injectable()
export class AccountBalanceService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** مانده‌ی جاری (بدون `at`) یا مانده‌ی مؤثر تا یک تاریخ گذشته. */
  async getAccountBalances(
    tenantId: string,
    accountId: string,
    at?: Date,
  ): Promise<AccountBalances> {
    return withTenantTransaction(this.db, tenantId, (transaction) =>
      this.getAccountBalancesInTransaction(transaction, tenantId, accountId, at),
    );
  }

  async getAccountBalancesInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    accountId: string,
    at?: Date,
  ): Promise<AccountBalances> {
    const [account] = await transaction
      .select({ id: ledgerAccounts.id })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.tenantId, tenantId), eq(ledgerAccounts.id, accountId)))
      .limit(1);

    if (account === undefined) {
      throw new LedgerAccountNotFoundError(accountId);
    }

    /*
     * تاریخ گذشته با `ledger_transactions.effective_at` سنجیده می‌شود، نه
     * `created_at` — قاعده‌ی ۲-۸: مبلغ/رویداد به لحظه‌ی مؤثر بودنش قفل
     * است، نه به لحظه‌ی فیزیکیِ درج ردیف.
     */
    const rows = await transaction
      .select({
        quantity: ledgerEntries.quantity,
        dimensionKind: assetDimensions.kind,
        coinCode: coinTypes.code,
      })
      .from(ledgerEntries)
      .innerJoin(
        ledgerTransactions,
        and(
          eq(ledgerEntries.tenantId, ledgerTransactions.tenantId),
          eq(ledgerEntries.transactionId, ledgerTransactions.id),
        ),
      )
      .innerJoin(
        assetDimensions,
        and(
          eq(ledgerEntries.tenantId, assetDimensions.tenantId),
          eq(ledgerEntries.dimensionId, assetDimensions.id),
        ),
      )
      .leftJoin(
        coinTypes,
        and(
          eq(assetDimensions.tenantId, coinTypes.tenantId),
          eq(assetDimensions.coinTypeId, coinTypes.id),
        ),
      )
      .where(
        and(
          eq(ledgerEntries.tenantId, tenantId),
          eq(ledgerEntries.accountId, accountId),
          at === undefined ? undefined : lte(ledgerTransactions.effectiveAt, at),
        ),
      );

    let rial: bigint | undefined;
    let gold: bigint | undefined;
    let silver: bigint | undefined;
    const coins = new Map<string, bigint>();

    for (const row of rows) {
      switch (row.dimensionKind) {
        case 'RIAL':
          rial = (rial ?? 0n) + row.quantity;
          break;
        case 'GOLD':
          gold = (gold ?? 0n) + row.quantity;
          break;
        case 'SILVER':
          silver = (silver ?? 0n) + row.quantity;
          break;
        case 'COIN': {
          // `coinCode` فقط برای FK ناسازگار (که ساختار داده اجازه نمی‌دهد) خالی می‌ماند.
          const key = row.coinCode ?? 'UNKNOWN_COIN_TYPE';
          coins.set(key, (coins.get(key) ?? 0n) + row.quantity);
          break;
        }
        default:
          break;
      }
    }

    const coinBalances: Record<string, number> = {};
    for (const [code, quantity] of coins) {
      coinBalances[code] = toSafeNumber(quantity);
    }

    return {
      ...(rial === undefined ? {} : { rial: rial.toString() }),
      ...(gold === undefined ? {} : { gold: gold.toString() }),
      ...(silver === undefined ? {} : { silver: silver.toString() }),
      coins: coinBalances,
    };
  }
}
