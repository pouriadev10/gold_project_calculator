import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { AuditService } from '../../platform/audit/audit.service';
import { DRIZZLE } from '../../platform/database/database.module';
import { coinTypes, coinTypeVersions } from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { AssetDimensionsService } from '../ledger/asset-dimensions.service';
import {
  CoinMintTypeMismatchError,
  CoinTypeVersionConflictError,
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
}

export interface CreateCoinTypeInput extends CoinSpecificationInput {
  readonly tenantId: string;
  readonly code: string;
}

export interface CreateCoinTypeVersionInput extends CoinSpecificationInput {
  readonly tenantId: string;
  readonly coinTypeId: string;
}

/** Versioned coin reference data; ledger quantities always remain independent counts. */
@Injectable()
export class CoinTypesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AssetDimensionsService) private readonly dimensions: AssetDimensionsService,
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
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:${input.code}`}, 0))`,
    );

    const [coinType] = await transaction
      .insert(coinTypes)
      .values({ tenantId: input.tenantId, code: input.code })
      .returning();
    const createdType = coinType!;

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: null,
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
        title: input.title,
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
      actorUserId: null,
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
              validTo: latest.validTo?.toISOString(),
            },
      afterData: {
        id: version.id,
        grossWeightUg: version.grossWeightUg.toString(),
        karat: version.karat.toString(),
        validFrom: version.validFrom.toISOString(),
        version: version.version.toString(),
      },
    });

    await this.dimensions.syncCoinDimensionInTransaction(transaction, {
      tenantId: input.tenantId,
      coinTypeId: input.coinTypeId,
      title: input.title,
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

  private assertMintType(input: CoinSpecificationInput): void {
    if ((input.mintType === 'CENTRAL_BANK') !== input.isCentralBankMinted) {
      throw new CoinMintTypeMismatchError();
    }
  }
}
