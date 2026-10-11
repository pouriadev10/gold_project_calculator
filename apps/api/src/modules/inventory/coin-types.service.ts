import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { AuditService } from '../../platform/audit/audit.service';
import { DRIZZLE } from '../../platform/database/database.module';
import { coinTypes, coinTypeVersions } from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { normalizeTextForStorage } from '../../shared/validation';
import { AssetDimensionsService } from '../ledger/asset-dimensions.service';
import { LedgerAccountsService } from '../ledger/ledger-accounts.service';
import {
  CoinMintTypeMismatchError,
  CoinTypeCodeConflictError,
  CoinTypeNotFoundError,
  CoinTypeVersionConflictError,
  InactiveCoinTypeError,
  InvalidCoinTypeVersionDateError,
} from './coin-types.errors';
import type { Database } from '../../platform/database/connect';
import type { CoinMintType, CoinTypeVersion } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

interface CoinSpecificationInput {
  readonly title: string;
  readonly mintType: CoinMintType;
  readonly grossWeightUg: bigint;
  readonly karat: number;
  readonly isCentralBankMinted: boolean;
  readonly validFrom: Date;
  readonly active: boolean;
  /** کاربری که تغییر را خواسته؛ مقداردهی اولیه‌ی مستأجر کاربر ندارد. */
  readonly actorUserId?: string | null;
}

export interface CreateCoinTypeInput extends CoinSpecificationInput {
  readonly tenantId: string;
  readonly code: string;
}

export interface CreateCoinTypeVersionInput extends CoinSpecificationInput {
  readonly tenantId: string;
  readonly coinTypeId: string;
}

/** یک نوع سکه با همه‌ی نسخه‌هایش، تازه‌ترین اول — صفحه‌ی تنظیمات انواع سکه (FE-081). */
export interface CoinTypeHistoryRecord {
  readonly coinTypeId: string;
  readonly code: string;
  readonly versions: readonly CoinTypeVersion[];
}

/** نسخه‌ی مؤثر یک نوع سکه در یک لحظه، همراه با کد ثابتش. */
export interface EffectiveCoinTypeRecord {
  readonly code: string;
  readonly version: CoinTypeVersion;
}

/** Versioned coin reference data; ledger quantities always remain independent counts. */
@Injectable()
export class CoinTypesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AssetDimensionsService) private readonly dimensions: AssetDimensionsService,
    @Inject(LedgerAccountsService) private readonly ledgerAccounts: LedgerAccountsService,
  ) {}

  async createType(input: CreateCoinTypeInput): Promise<CoinTypeVersion> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.createTypeInTransaction(transaction, input),
    );
  }

  async createTypeInTransaction(
    transaction: TenantTransaction,
    input: CreateCoinTypeInput,
  ): Promise<CoinTypeVersion> {
    this.assertMintType(input);
    const code = normalizeTextForStorage(input.code);
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:${code}`}, 0))`,
    );

    /*
     * پیش‌بررسی زیر همان قفل، به‌جای تکیه بر خطای unique دیتابیس: خطای
     * دیتابیس کل تراکنش را باطل می‌کند و کد تکراری باید ۴۰۹ خوانا باشد.
     */
    const [existing] = await transaction
      .select({ id: coinTypes.id })
      .from(coinTypes)
      .where(and(eq(coinTypes.tenantId, input.tenantId), eq(coinTypes.code, code)))
      .limit(1);
    if (existing !== undefined) {
      throw new CoinTypeCodeConflictError(code);
    }

    const [coinType] = await transaction
      .insert(coinTypes)
      .values({ tenantId: input.tenantId, code })
      .returning();
    const createdType = coinType!;

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: 'COIN_TYPE_CREATED',
      entityType: 'coin_type',
      entityId: createdType.id,
      afterData: { code: createdType.code },
    });

    return this.createVersionInTransaction(transaction, {
      tenantId: input.tenantId,
      coinTypeId: createdType.id,
      title: input.title,
      mintType: input.mintType,
      grossWeightUg: input.grossWeightUg,
      karat: input.karat,
      isCentralBankMinted: input.isCentralBankMinted,
      validFrom: input.validFrom,
      active: input.active,
      actorUserId: input.actorUserId ?? null,
    });
  }

  async createVersion(input: CreateCoinTypeVersionInput): Promise<CoinTypeVersion> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.createVersionInTransaction(transaction, input),
    );
  }

  async createVersionInTransaction(
    transaction: TenantTransaction,
    input: CreateCoinTypeVersionInput,
  ): Promise<CoinTypeVersion> {
    this.assertMintType(input);
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:${input.coinTypeId}`}, 0))`,
    );

    const [coinType] = await transaction
      .select({ id: coinTypes.id })
      .from(coinTypes)
      .where(and(eq(coinTypes.tenantId, input.tenantId), eq(coinTypes.id, input.coinTypeId)))
      .limit(1);
    if (coinType === undefined) {
      throw new CoinTypeNotFoundError(input.coinTypeId);
    }
    const title = normalizeTextForStorage(input.title);

    const [latest] = await transaction
      .select()
      .from(coinTypeVersions)
      .where(
        and(
          eq(coinTypeVersions.tenantId, input.tenantId),
          eq(coinTypeVersions.coinTypeId, input.coinTypeId),
        ),
      )
      .orderBy(desc(coinTypeVersions.version))
      .limit(1);

    if (latest !== undefined) {
      const latestBoundary = latest.validTo ?? latest.validFrom;
      if (input.validFrom.getTime() < latestBoundary.getTime()) {
        throw new InvalidCoinTypeVersionDateError();
      }

      if (latest.validTo === null) {
        if (input.validFrom.getTime() <= latest.validFrom.getTime()) {
          throw new InvalidCoinTypeVersionDateError();
        }

        const [closed] = await transaction
          .update(coinTypeVersions)
          .set({ validTo: input.validFrom })
          .where(and(eq(coinTypeVersions.id, latest.id), isNull(coinTypeVersions.validTo)))
          .returning({ id: coinTypeVersions.id });

        if (closed === undefined) {
          throw new CoinTypeVersionConflictError();
        }
      }
    }

    const [created] = await transaction
      .insert(coinTypeVersions)
      .values({
        tenantId: input.tenantId,
        coinTypeId: input.coinTypeId,
        title,
        mintType: input.mintType,
        grossWeightUg: input.grossWeightUg,
        karat: input.karat,
        isCentralBankMinted: input.isCentralBankMinted,
        validFrom: input.validFrom,
        version: (latest?.version ?? 0) + 1,
        active: input.active,
      })
      .returning();
    const version = created!;

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: 'COIN_TYPE_VERSION_CREATED',
      entityType: 'coin_type_version',
      entityId: version.id,
      beforeData:
        latest === undefined
          ? undefined
          : {
              id: latest.id,
              grossWeightUg: latest.grossWeightUg.toString(),
              karat: latest.karat.toString(),
              mintType: latest.mintType,
              active: latest.active.toString(),
              validTo: latest.validTo?.toISOString(),
            },
      afterData: {
        id: version.id,
        grossWeightUg: version.grossWeightUg.toString(),
        karat: version.karat.toString(),
        mintType: version.mintType,
        active: version.active.toString(),
        validFrom: version.validFrom.toISOString(),
        version: version.version.toString(),
      },
    });

    await this.dimensions.syncCoinDimensionInTransaction(transaction, {
      tenantId: input.tenantId,
      coinTypeId: input.coinTypeId,
      title,
      active: input.active,
    });

    await this.ledgerAccounts.syncCoinInventoryAccountInTransaction(transaction, {
      tenantId: input.tenantId,
      coinTypeId: input.coinTypeId,
      title,
      active: input.active,
    });

    return version;
  }

  async getEffective(
    tenantId: string,
    coinTypeId: string,
    effectiveAt: Date,
  ): Promise<CoinTypeVersion | undefined> {
    return withTenantTransaction(this.db, tenantId, (transaction) =>
      this.getEffectiveInTransaction(transaction, tenantId, coinTypeId, effectiveAt),
    );
  }

  async getEffectiveInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    coinTypeId: string,
    effectiveAt: Date,
  ): Promise<CoinTypeVersion | undefined> {
    const [version] = await transaction
      .select()
      .from(coinTypeVersions)
      .where(
        and(
          eq(coinTypeVersions.tenantId, tenantId),
          eq(coinTypeVersions.coinTypeId, coinTypeId),
          lte(coinTypeVersions.validFrom, effectiveAt),
          or(isNull(coinTypeVersions.validTo), gt(coinTypeVersions.validTo, effectiveAt)),
        ),
      )
      .orderBy(desc(coinTypeVersions.validFrom))
      .limit(1);

    return version;
  }

  /** کد ثابت (و نرمال‌شده‌ی) یک نوع سکه؛ نوع ناموجود در این مستأجر خطای صریح است. */
  async getCodeInTransaction(transaction: TenantTransaction, tenantId: string, coinTypeId: string): Promise<string> {
    const [coinType] = await transaction
      .select({ code: coinTypes.code })
      .from(coinTypes)
      .where(and(eq(coinTypes.tenantId, tenantId), eq(coinTypes.id, coinTypeId)))
      .limit(1);
    if (coinType === undefined) {
      throw new CoinTypeNotFoundError(coinTypeId);
    }
    return coinType.code;
  }

  /**
   * نسخه‌ی مؤثر هر نوع سکه در لحظه‌ی `at` — فعال و غیرفعال، به ترتیب ساخت.
   * نوعی که در آن لحظه نسخه‌ی مؤثر ندارد در فهرست نیست.
   */
  async listEffective(tenantId: string, at: Date): Promise<EffectiveCoinTypeRecord[]> {
    return withTenantTransaction(this.db, tenantId, (transaction) =>
      transaction
        .select({ code: coinTypes.code, version: coinTypeVersions })
        .from(coinTypeVersions)
        .innerJoin(
          coinTypes,
          and(eq(coinTypes.tenantId, coinTypeVersions.tenantId), eq(coinTypes.id, coinTypeVersions.coinTypeId)),
        )
        .where(
          and(
            eq(coinTypeVersions.tenantId, tenantId),
            lte(coinTypeVersions.validFrom, at),
            or(isNull(coinTypeVersions.validTo), gt(coinTypeVersions.validTo, at)),
          ),
        )
        .orderBy(asc(coinTypes.createdAt), asc(coinTypes.code)),
    );
  }

  /** همه‌ی انواع سکه با تاریخچه‌ی کامل نسخه‌ها، تازه‌ترین نسخه اول. */
  async listHistory(tenantId: string): Promise<CoinTypeHistoryRecord[]> {
    const rows = await withTenantTransaction(this.db, tenantId, (transaction) =>
      transaction
        .select({ code: coinTypes.code, version: coinTypeVersions })
        .from(coinTypeVersions)
        .innerJoin(
          coinTypes,
          and(eq(coinTypes.tenantId, coinTypeVersions.tenantId), eq(coinTypes.id, coinTypeVersions.coinTypeId)),
        )
        .where(eq(coinTypeVersions.tenantId, tenantId))
        .orderBy(asc(coinTypes.createdAt), asc(coinTypes.code), desc(coinTypeVersions.version)),
    );

    return groupCoinTypeHistory(rows);
  }

  async requireSelectableForSale(
    tenantId: string,
    coinTypeId: string,
    effectiveAt: Date,
  ): Promise<CoinTypeVersion> {
    return withTenantTransaction(this.db, tenantId, (transaction) =>
      this.requireSelectableForSaleInTransaction(transaction, tenantId, coinTypeId, effectiveAt),
    );
  }

  /** Mirrors JewelryItemsService.requireSelectableForSaleInTransaction for coin types. */
  async requireSelectableForSaleInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    coinTypeId: string,
    effectiveAt: Date,
  ): Promise<CoinTypeVersion> {
    const version = await this.getEffectiveInTransaction(transaction, tenantId, coinTypeId, effectiveAt);

    if (version === undefined) {
      throw new CoinTypeNotFoundError(coinTypeId);
    }
    if (!version.active) {
      throw new InactiveCoinTypeError(coinTypeId);
    }

    return version;
  }

  private assertMintType(input: CoinSpecificationInput): void {
    if ((input.mintType === 'CENTRAL_BANK') !== input.isCentralBankMinted) {
      throw new CoinMintTypeMismatchError();
    }
  }
}

/** ردیف‌های مرتب‌شده‌ی (نوع، نسخه‌ی نزولی) را به یک رکورد برای هر نوع تبدیل می‌کند. */
export function groupCoinTypeHistory(rows: readonly EffectiveCoinTypeRecord[]): CoinTypeHistoryRecord[] {
  const byType = new Map<string, { coinTypeId: string; code: string; versions: CoinTypeVersion[] }>();
  for (const row of rows) {
    const existing = byType.get(row.version.coinTypeId);
    if (existing === undefined) {
      byType.set(row.version.coinTypeId, {
        coinTypeId: row.version.coinTypeId,
        code: row.code,
        versions: [row.version],
      });
    } else {
      existing.versions.push(row.version);
    }
  }
  return [...byType.values()];
}
