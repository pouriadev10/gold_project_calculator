import { Inject, Injectable } from '@nestjs/common';
import { CalcError, articlePureMg, grossMg, karat } from '@gold/core-calc';
import { and, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { AuditService } from '../../platform/audit/audit.service';
import { DRIZZLE } from '../../platform/database/database.module';
import { isUniqueViolation } from '../../platform/database/pg-errors';
import { jewelryItemVersions, jewelryItems } from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import {
  InvalidJewelryItemVersionDateError,
  InvalidJewelryKaratError,
  InvalidJewelryWeightError,
  JewelryDeductionExceedsGrossError,
  JewelryItemCodeConflictError,
  JewelryItemVersionConflictError,
} from './jewelry-items.errors';
import type { PureMg } from '@gold/core-calc';
import type { Database } from '../../platform/database/connect';
import type { JewelryItemVersion, JewelryWageType } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

interface JewelrySpecificationInput {
  readonly title: string;
  readonly grossWeightMg: bigint;
  readonly karat: number;
  readonly stoneWeightMg: bigint;
  readonly otherDeductionWeightMg: bigint;
  readonly wageType: JewelryWageType;
  readonly wageValue: bigint;
  readonly validFrom: Date;
  readonly active: boolean;
}

export interface CreateJewelryItemInput extends JewelrySpecificationInput {
  readonly tenantId: string;
  readonly code: string;
}

export interface CreateJewelryItemVersionInput extends JewelrySpecificationInput {
  readonly tenantId: string;
  readonly jewelryItemId: string;
}

/**
 * وزن خالص طلای یک نسخه — همیشه محاسبه‌شده، هرگز ذخیره‌شده.
 *
 * قاعده‌ی BE-025: «وزن خالص توسط `core-calc` محاسبه شود» و «هیچ فرمول
 * تکراری در API نوشته نشده باشد». این تابع فقط ستون‌های ردیف را به
 * `articlePureMg` می‌دهد و خودش هیچ حسابی نمی‌کند.
 */
export function pureWeightOf(
  version: Pick<
    JewelryItemVersion,
    'grossWeightMg' | 'stoneWeightMg' | 'otherDeductionWeightMg' | 'karat'
  >,
): PureMg {
  return articlePureMg(
    grossMg(version.grossWeightMg),
    {
      stone: grossMg(version.stoneWeightMg),
      other: grossMg(version.otherDeductionWeightMg),
    },
    karat(version.karat),
  );
}

/**
 * کالای زیورآلات نسخه‌دار — BE-025.
 *
 * ساختارش عمداً آینه‌ی `CoinTypesService` است: هویت پایدار در یک جدول،
 * مشخصات مؤثر بر مبلغ در جدول نسخه‌ها. دلیلش قاعده‌ی ۲-۶ است — فاکتور
 * دو ماه پیش باید امروز همان اعداد را بازتولید کند، حتی اگر وزن یا اجرت
 * کالا از آن زمان عوض شده باشد.
 */
@Injectable()
export class JewelryItemsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async createItem(input: CreateJewelryItemInput): Promise<JewelryItemVersion> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.createItemInTransaction(transaction, input),
    );
  }

  async createItemInTransaction(
    transaction: TenantTransaction,
    input: CreateJewelryItemInput,
  ): Promise<JewelryItemVersion> {
    this.assertSpecification(input);

    /*
     * قفل مشورتی روی «مستأجر + کد»، همان الگوی BE-020: دو درخواست
     * هم‌زمان با یک کد سریالیزه می‌شوند به‌جای اینکه هر دو تا مرحله‌ی
     * درج پیش بروند.
     */
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:${input.code}`}, 0))`,
    );

    let createdItem;

    try {
      const [item] = await transaction
        .insert(jewelryItems)
        .values({ tenantId: input.tenantId, code: input.code })
        .returning();
      createdItem = item!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new JewelryItemCodeConflictError(input.code);
      }
      throw error;
    }

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: null,
      action: 'JEWELRY_ITEM_CREATED',
      entityType: 'jewelry_item',
      entityId: createdItem.id,
      afterData: { code: createdItem.code },
    });

    return this.createVersionInTransaction(transaction, {
      tenantId: input.tenantId,
      jewelryItemId: createdItem.id,
      title: input.title,
      grossWeightMg: input.grossWeightMg,
      karat: input.karat,
      stoneWeightMg: input.stoneWeightMg,
      otherDeductionWeightMg: input.otherDeductionWeightMg,
      wageType: input.wageType,
      wageValue: input.wageValue,
      validFrom: input.validFrom,
      active: input.active,
    });
  }

  async createVersion(input: CreateJewelryItemVersionInput): Promise<JewelryItemVersion> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.createVersionInTransaction(transaction, input),
    );
  }

  async createVersionInTransaction(
    transaction: TenantTransaction,
    input: CreateJewelryItemVersionInput,
  ): Promise<JewelryItemVersion> {
    this.assertSpecification(input);

    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:${input.jewelryItemId}`}, 0))`,
    );

    const [latest] = await transaction
      .select()
      .from(jewelryItemVersions)
      .where(
        and(
          eq(jewelryItemVersions.tenantId, input.tenantId),
          eq(jewelryItemVersions.jewelryItemId, input.jewelryItemId),
        ),
      )
      .orderBy(desc(jewelryItemVersions.version))
      .limit(1);

    if (latest !== undefined) {
      const latestBoundary = latest.validTo ?? latest.validFrom;

      if (input.validFrom.getTime() < latestBoundary.getTime()) {
        throw new InvalidJewelryItemVersionDateError();
      }

      if (latest.validTo === null) {
        if (input.validFrom.getTime() <= latest.validFrom.getTime()) {
          throw new InvalidJewelryItemVersionDateError();
        }

        /*
         * بستن نسخه‌ی باز مشروط به هنوز باز بودنش است. اگر درخواست
         * هم‌زمان دیگری زودتر بسته باشد، هیچ ردیفی برنمی‌گردد و به‌جای
         * ساختن دو نسخه‌ی هم‌پوشان، خطا می‌دهیم.
         */
        const [closed] = await transaction
          .update(jewelryItemVersions)
          .set({ validTo: input.validFrom })
          .where(and(eq(jewelryItemVersions.id, latest.id), isNull(jewelryItemVersions.validTo)))
          .returning({ id: jewelryItemVersions.id });

        if (closed === undefined) {
          throw new JewelryItemVersionConflictError();
        }
      }
    }

    const [created] = await transaction
      .insert(jewelryItemVersions)
      .values({
        tenantId: input.tenantId,
        jewelryItemId: input.jewelryItemId,
        title: input.title,
        grossWeightMg: input.grossWeightMg,
        karat: input.karat,
        stoneWeightMg: input.stoneWeightMg,
        otherDeductionWeightMg: input.otherDeductionWeightMg,
        wageType: input.wageType,
        wageValue: input.wageValue,
        validFrom: input.validFrom,
        version: (latest?.version ?? 0) + 1,
        active: input.active,
      })
      .returning();
    const version = created!;

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: null,
      action: 'JEWELRY_ITEM_VERSION_CREATED',
      entityType: 'jewelry_item_version',
      entityId: version.id,
      beforeData:
        latest === undefined
          ? undefined
          : {
              id: latest.id,
              grossWeightMg: latest.grossWeightMg.toString(),
              karat: latest.karat.toString(),
              wageType: latest.wageType,
              wageValue: latest.wageValue.toString(),
              validTo: latest.validTo?.toISOString(),
            },
      afterData: {
        id: version.id,
        grossWeightMg: version.grossWeightMg.toString(),
        karat: version.karat.toString(),
        stoneWeightMg: version.stoneWeightMg.toString(),
        otherDeductionWeightMg: version.otherDeductionWeightMg.toString(),
        wageType: version.wageType,
        wageValue: version.wageValue.toString(),
        // وزن خالصِ محاسبه‌شده در ممیزی می‌ماند تا بعداً معلوم باشد آن
        // روز چه عددی مبنای فاکتور بوده.
        pureWeightMg: pureWeightOf(version).toString(),
        validFrom: version.validFrom.toISOString(),
        version: version.version.toString(),
      },
    });

    return version;
  }

  async getEffective(
    tenantId: string,
    jewelryItemId: string,
    effectiveAt: Date,
  ): Promise<JewelryItemVersion | undefined> {
    return withTenantTransaction(this.db, tenantId, (transaction) =>
      this.getEffectiveInTransaction(transaction, tenantId, jewelryItemId, effectiveAt),
    );
  }

  async getEffectiveInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    jewelryItemId: string,
    effectiveAt: Date,
  ): Promise<JewelryItemVersion | undefined> {
    const [version] = await transaction
      .select()
      .from(jewelryItemVersions)
      .where(
        and(
          eq(jewelryItemVersions.tenantId, tenantId),
          eq(jewelryItemVersions.jewelryItemId, jewelryItemId),
          lte(jewelryItemVersions.validFrom, effectiveAt),
          or(isNull(jewelryItemVersions.validTo), gt(jewelryItemVersions.validTo, effectiveAt)),
        ),
      )
      .orderBy(desc(jewelryItemVersions.validFrom))
      .limit(1);

    return version;
  }

  /**
   * قواعدی که پیش از رسیدن به دیتابیس بررسی می‌شوند.
   *
   * ترتیب مهم است. اول کرانه‌های ساده — که هرکدام خطای مخصوص خودشان را
   * می‌دهند — و **آخر** فراخوانی `core-calc`. چون آن‌وقت تنها `CalcError`
   * باقی‌مانده می‌تواند «کسورات بیشتر از وزن ناخالص» باشد و نگاشتش دقیق
   * است. اگر ترتیب برعکس بود، عیار نامعتبر هم پیام «کسورات زیاد است»
   * می‌گرفت و کاربر دنبال مشکلی می‌گشت که وجود نداشت.
   *
   * قاعده‌ی خودِ کسورات اینجا بازنویسی نمی‌شود؛ `chargeableGrossMg` در
   * `core-calc` مالک آن است و همین‌جا صدا زده می‌شود.
   */
  private assertSpecification(input: JewelrySpecificationInput): void {
    try {
      karat(input.karat);
    } catch (error) {
      if (error instanceof CalcError) {
        throw new InvalidJewelryKaratError(input.karat);
      }
      throw error;
    }

    if (input.grossWeightMg <= 0n) {
      throw new InvalidJewelryWeightError('Gross weight must be greater than zero');
    }

    if (input.stoneWeightMg < 0n || input.otherDeductionWeightMg < 0n) {
      throw new InvalidJewelryWeightError('Deduction weights cannot be negative');
    }

    if (input.wageValue < 0n) {
      throw new InvalidJewelryWeightError('Wage value cannot be negative');
    }

    try {
      pureWeightOf(input);
    } catch (error) {
      if (error instanceof CalcError) {
        throw new JewelryDeductionExceedsGrossError();
      }
      throw error;
    }
  }
}
