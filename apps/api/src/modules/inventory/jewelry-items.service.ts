import { Inject, Injectable } from '@nestjs/common';
import { CalcError, articlePureMg, grossMg, karat } from '@gold/core-calc';
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  ilike,
  isNull,
  like,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { AuditService } from '../../platform/audit/audit.service';
import { DRIZZLE } from '../../platform/database/database.module';
import { isUniqueViolation } from '../../platform/database/pg-errors';
import { jewelryItemVersions, jewelryItems } from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { normalizeTextForSearch, normalizeTextForStorage } from '../../shared/validation';
import {
  InactiveJewelryItemError,
  InvalidJewelryItemVersionDateError,
  InvalidJewelryKaratError,
  InvalidJewelryWeightError,
  JewelryDeductionExceedsGrossError,
  JewelryItemCodeConflictError,
  JewelryItemNotFoundError,
  JewelryItemVersionConflictError,
} from './jewelry-items.errors';
import type { PureMg } from '@gold/core-calc';
import type { SQL } from 'drizzle-orm';
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
  /** برای ممیزی. `undefined` یعنی کار داخلی سیستم، نه یک کاربر. */
  readonly actorUserId?: string | null | undefined;
}

export interface CreateJewelryItemInput extends JewelrySpecificationInput {
  readonly tenantId: string;
  readonly code: string;
}

export interface CreateJewelryItemVersionInput extends JewelrySpecificationInput {
  readonly tenantId: string;
  readonly jewelryItemId: string;
}

/** مشخصات مالی — تغییرشان نسخه‌ی جدید می‌سازد. `title` عمداً اینجا نیست. */
interface JewelryFinancialSpecification {
  readonly grossWeightMg: bigint;
  readonly karat: number;
  readonly stoneWeightMg: bigint;
  readonly otherDeductionWeightMg: bigint;
  readonly wageType: JewelryWageType;
  readonly wageValue: bigint;
}

/**
 * فیلدهای اختیاری صریحاً `| undefined` دارند چون `exactOptionalPropertyTypes`
 * روشن است: بدون آن، controller نمی‌تواند فیلدِ نفرستاده را به‌صورت
 * `undefined` پاس بدهد و مجبور می‌شد شیء را تکه‌تکه بسازد.
 */
export interface UpdateJewelryItemInput {
  readonly tenantId: string;
  readonly jewelryItemId: string;
  readonly title?: string | undefined;
  readonly grossWeightMg?: bigint | undefined;
  readonly karat?: number | undefined;
  readonly stoneWeightMg?: bigint | undefined;
  readonly otherDeductionWeightMg?: bigint | undefined;
  readonly wageType?: JewelryWageType | undefined;
  readonly wageValue?: bigint | undefined;
  /** فقط وقتی به کار می‌رود که مشخصات مالی عوض شوند. پیش‌فرض: همین حالا. */
  readonly validFrom?: Date | undefined;
  readonly actorUserId?: string | null | undefined;
}

/**
 * نسخه به‌همراه کد انبار.
 *
 * کد روی `jewelry_items` است و نه روی نسخه — هویت کالاست، نه مشخصه‌ی
 * نسخه‌دار. ولی هر پاسخ API به هر دو نیاز دارد، پس اینجا کنار هم می‌آیند.
 */
export interface JewelryItemDetail {
  readonly code: string;
  readonly version: JewelryItemVersion;
}

export interface ListJewelryItemsQuery {
  readonly search?: string | undefined;
  readonly active?: boolean | undefined;
  readonly limit: number;
  readonly offset: number;
}

export interface JewelryItemPage {
  readonly items: readonly JewelryItemDetail[];
  readonly total: number;
}

export interface DeactivateJewelryItemInput {
  readonly tenantId: string;
  readonly jewelryItemId: string;
  readonly actorUserId?: string | null | undefined;
}

/**
 * شرط اتصال نسخه به کالا — **مستأجر هم بخشی از آن است**.
 *
 * فقط `id = jewelry_item_id` هم کار می‌کرد چون RLS ردیف‌های مستأجر دیگر
 * را می‌پوشاند، ولی همان کلید خارجی مرکبی که در BE-025 ساخته شد اینجا
 * هم رعایت می‌شود: اتصال بین‌مستأجری حتی به‌صورت نوشتاری هم ممکن نباشد.
 */
const sameTenantItem = and(
  eq(jewelryItems.tenantId, jewelryItemVersions.tenantId),
  eq(jewelryItems.id, jewelryItemVersions.jewelryItemId),
);

/** آیا مشخصات مالی عوض شده‌اند؟ فقط این‌ها نسخه‌ی جدید می‌سازند. */
function financialSpecificationChanged(
  current: JewelryFinancialSpecification,
  next: JewelryFinancialSpecification,
): boolean {
  return (
    current.grossWeightMg !== next.grossWeightMg ||
    current.karat !== next.karat ||
    current.stoneWeightMg !== next.stoneWeightMg ||
    current.otherDeductionWeightMg !== next.otherDeductionWeightMg ||
    current.wageType !== next.wageType ||
    current.wageValue !== next.wageValue
  );
}

/**
 * `%` و `_` در ورودی کاربر معنای wildcard دارند و باید خنثی شوند، وگرنه
 * جست‌وجوی «٪» کل کاتالوگ را برمی‌گرداند. کاراکتر فرار پیش‌فرض LIKE در
 * PostgreSQL همان backslash است، پس نیازی به `ESCAPE` صریح نیست.
 */
function containsPattern(value: string): string {
  return `%${value.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
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
      actorUserId: input.actorUserId ?? null,
      action: 'JEWELRY_ITEM_CREATED',
      entityType: 'jewelry_item',
      entityId: createdItem.id,
      afterData: { code: createdItem.code },
    });

    return this.createVersionInTransaction(transaction, {
      tenantId: input.tenantId,
      jewelryItemId: createdItem.id,
      title: input.title,
      actorUserId: input.actorUserId,
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

    /*
     * نرمال‌سازی اینجاست و نه در controller، تا ناوردای
     * `normalizedTitle === searchKey(title)` مستقل از اینکه چه کسی سرویس
     * را صدا زده برقرار بماند.
     */
    const title = normalizeTextForStorage(input.title);

    const [created] = await transaction
      .insert(jewelryItemVersions)
      .values({
        tenantId: input.tenantId,
        jewelryItemId: input.jewelryItemId,
        title,
        normalizedTitle: normalizeTextForSearch(title),
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
      actorUserId: input.actorUserId ?? null,
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
   * فهرست کاتالوگ — BE-026.
   *
   * همیشه **نسخه‌ی باز** هر کالا (`valid_to IS NULL`) برمی‌گردد، یعنی
   * دقیقاً یک ردیف به ازای هر کالا. نسخه‌های بسته تاریخ‌اند و جایشان
   * فاکتورهای گذشته است، نه صفحه‌ی کاتالوگ.
   */
  async list(tenantId: string, query: ListJewelryItemsQuery): Promise<JewelryItemPage> {
    return withTenantTransaction(this.db, tenantId, async (transaction) => {
      const filters = this.listFilters(tenantId, query);

      const rows = await this.detailQuery(transaction)
        .where(filters)
        .orderBy(jewelryItems.code)
        .limit(query.limit)
        .offset(query.offset);

      const [totals] = await transaction
        .select({ value: count() })
        .from(jewelryItemVersions)
        .innerJoin(jewelryItems, sameTenantItem)
        .where(filters);

      return { items: rows, total: totals?.value ?? 0 };
    });
  }

  /** نسخه‌ی باز کالا — «کالا همان‌طور که امروز هست». */
  async getLatest(tenantId: string, jewelryItemId: string): Promise<JewelryItemDetail> {
    return withTenantTransaction(this.db, tenantId, (transaction) =>
      this.getLatestInTransaction(transaction, tenantId, jewelryItemId),
    );
  }

  async getLatestInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    jewelryItemId: string,
  ): Promise<JewelryItemDetail> {
    const [row] = await this.detailQuery(transaction)
      .where(
        and(
          eq(jewelryItemVersions.tenantId, tenantId),
          eq(jewelryItemVersions.jewelryItemId, jewelryItemId),
          isNull(jewelryItemVersions.validTo),
        ),
      )
      .limit(1);

    if (row === undefined) {
      throw new JewelryItemNotFoundError(jewelryItemId);
    }

    return row;
  }

  /** کالا آن‌طور که در یک لحظه‌ی مشخص بود — همان چیزی که فاکتور گذشته دیده. */
  async getEffectiveDetail(
    tenantId: string,
    jewelryItemId: string,
    effectiveAt: Date,
  ): Promise<JewelryItemDetail> {
    return withTenantTransaction(this.db, tenantId, async (transaction) => {
      const [row] = await this.detailQuery(transaction)
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

      if (row === undefined) {
        throw new JewelryItemNotFoundError(jewelryItemId);
      }

      return row;
    });
  }

  async update(input: UpdateJewelryItemInput): Promise<JewelryItemDetail> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.updateInTransaction(transaction, input),
    );
  }

  /**
   * تصمیم مدل درباره‌ی «چه چیزی نسخه می‌سازد» — معیار BE-026.
   *
   * تغییر وزن، عیار یا اجرت **نسخه‌ی جدید** می‌سازد و نسخه‌ی قبلی دست
   * نمی‌خورد؛ قاعده‌ی ۲-۶ می‌گوید فاکتور دو ماه پیش باید امروز همان اعداد
   * را بازتولید کند.
   *
   * تغییر عنوان اما روی همان نسخه‌ی **باز** می‌نشیند و شماره‌ی نسخه را
   * جلو نمی‌برد. عنوان روی هیچ عددی اثر ندارد، فاکتور هم مشخصات لحظه‌ی
   * فروش را snapshot می‌کند (BE-025)، پس نسخه‌ی جدید فقط تاریخچه را با
   * ردیف‌هایی پر می‌کرد که هیچ‌کدام مبلغ متفاوتی نمی‌سازند. نسخه‌های
   * **بسته** در هیچ حالتی ویرایش نمی‌شوند — آن‌ها تاریخ‌اند.
   */
  async updateInTransaction(
    transaction: TenantTransaction,
    input: UpdateJewelryItemInput,
  ): Promise<JewelryItemDetail> {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:${input.jewelryItemId}`}, 0))`,
    );

    const current = await this.getLatestInTransaction(
      transaction,
      input.tenantId,
      input.jewelryItemId,
    );
    const title =
      input.title === undefined ? current.version.title : normalizeTextForStorage(input.title);
    const merged: JewelryFinancialSpecification = {
      grossWeightMg: input.grossWeightMg ?? current.version.grossWeightMg,
      karat: input.karat ?? current.version.karat,
      stoneWeightMg: input.stoneWeightMg ?? current.version.stoneWeightMg,
      otherDeductionWeightMg:
        input.otherDeductionWeightMg ?? current.version.otherDeductionWeightMg,
      wageType: input.wageType ?? current.version.wageType,
      wageValue: input.wageValue ?? current.version.wageValue,
    };

    if (financialSpecificationChanged(current.version, merged)) {
      const version = await this.createVersionInTransaction(transaction, {
        tenantId: input.tenantId,
        jewelryItemId: input.jewelryItemId,
        title,
        ...merged,
        validFrom: input.validFrom ?? new Date(),
        // وضعیت فعال از نسخه‌ی قبلی ارث می‌رسد: ویرایش مشخصات، کالای
        // غیرفعال‌شده را دوباره قابل فروش نمی‌کند.
        active: current.version.active,
        actorUserId: input.actorUserId,
      });

      return { code: current.code, version };
    }

    if (title === current.version.title) {
      return current;
    }

    const [updated] = await transaction
      .update(jewelryItemVersions)
      .set({ title, normalizedTitle: normalizeTextForSearch(title) })
      .where(
        and(eq(jewelryItemVersions.id, current.version.id), isNull(jewelryItemVersions.validTo)),
      )
      .returning();

    if (updated === undefined) {
      throw new JewelryItemVersionConflictError();
    }

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: 'JEWELRY_ITEM_TITLE_UPDATED',
      entityType: 'jewelry_item_version',
      entityId: updated.id,
      beforeData: { title: current.version.title },
      afterData: { title: updated.title, version: updated.version.toString() },
    });

    return { code: current.code, version: updated };
  }

  async deactivate(input: DeactivateJewelryItemInput): Promise<JewelryItemDetail> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.deactivateInTransaction(transaction, input),
    );
  }

  /**
   * غیرفعال‌سازی — حذف فیزیکی وجود ندارد.
   *
   * روی نسخه‌ی باز می‌نشیند و نسخه‌ی جدید نمی‌سازد: این یک وضعیت است، نه
   * یک مشخصه‌ی مالی. فاکتورهای گذشته که به نسخه‌های بسته ارجاع می‌دهند
   * دست‌نخورده می‌مانند.
   *
   * تکرار درخواست روی کالای از قبل غیرفعال بی‌اثر است و همان وضعیت را
   * برمی‌گرداند.
   */
  async deactivateInTransaction(
    transaction: TenantTransaction,
    input: DeactivateJewelryItemInput,
  ): Promise<JewelryItemDetail> {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:${input.jewelryItemId}`}, 0))`,
    );

    const current = await this.getLatestInTransaction(
      transaction,
      input.tenantId,
      input.jewelryItemId,
    );

    if (!current.version.active) {
      return current;
    }

    const [updated] = await transaction
      .update(jewelryItemVersions)
      .set({ active: false })
      .where(
        and(eq(jewelryItemVersions.id, current.version.id), isNull(jewelryItemVersions.validTo)),
      )
      .returning();

    if (updated === undefined) {
      throw new JewelryItemVersionConflictError();
    }

    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: 'JEWELRY_ITEM_DEACTIVATED',
      entityType: 'jewelry_item_version',
      entityId: updated.id,
      beforeData: { active: true },
      afterData: { active: false, version: updated.version.toString() },
    });

    return { code: current.code, version: updated };
  }

  /**
   * تنها دروازه‌ی انتخاب کالا در سند جدید — معیار BE-026.
   *
   * ماژول فروش باید از همین‌جا رد شود و نه از `getEffective`، وگرنه
   * «کالای غیرفعال در فروش جدید قابل انتخاب نباشد» به یک شرط `if` در هر
   * صدا‌زننده تبدیل می‌شود که روزی یکی‌شان فراموشش می‌کند.
   */
  async requireSelectableForSale(
    tenantId: string,
    jewelryItemId: string,
    effectiveAt: Date,
  ): Promise<JewelryItemVersion> {
    return withTenantTransaction(this.db, tenantId, (transaction) =>
      this.requireSelectableForSaleInTransaction(transaction, tenantId, jewelryItemId, effectiveAt),
    );
  }

  async requireSelectableForSaleInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    jewelryItemId: string,
    effectiveAt: Date,
  ): Promise<JewelryItemVersion> {
    const version = await this.getEffectiveInTransaction(
      transaction,
      tenantId,
      jewelryItemId,
      effectiveAt,
    );

    if (version === undefined) {
      throw new JewelryItemNotFoundError(jewelryItemId);
    }
    if (!version.active) {
      throw new InactiveJewelryItemError(jewelryItemId);
    }

    return version;
  }

  private detailQuery(transaction: TenantTransaction) {
    return transaction
      .select({ code: jewelryItems.code, version: getTableColumns(jewelryItemVersions) })
      .from(jewelryItemVersions)
      .innerJoin(jewelryItems, sameTenantItem);
  }

  private listFilters(tenantId: string, query: ListJewelryItemsQuery): SQL {
    const conditions: SQL[] = [
      eq(jewelryItemVersions.tenantId, tenantId),
      isNull(jewelryItemVersions.validTo),
    ];

    if (query.active !== undefined) {
      conditions.push(eq(jewelryItemVersions.active, query.active));
    }

    const search = query.search?.trim() ?? '';

    if (search !== '') {
      /*
       * کد با متن خام و بدون حساسیت به بزرگی حروف تطبیق می‌شود، چون
       * شناسه است و نرمال‌سازی فارسی روی شناسه ممنوع است. عنوان با کلید
       * نرمال‌شده تطبیق می‌شود تا «انگشتر» با یای عربی هم پیدا شود.
       */
      const matches: SQL[] = [ilike(jewelryItems.code, containsPattern(search))];
      const titleKey = normalizeTextForSearch(search);

      if (titleKey !== '') {
        matches.push(like(jewelryItemVersions.normalizedTitle, containsPattern(titleKey)));
      }

      conditions.push(or(...matches) as SQL);
    }

    return and(...conditions) as SQL;
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
