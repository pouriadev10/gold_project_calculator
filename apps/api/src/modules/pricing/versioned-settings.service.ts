import { and, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service';
import { DRIZZLE } from '../../platform/database/database.module';
import { versionedSettings } from '../../platform/database/schema';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import {
  InvalidSettingVersionDateError,
  RequiredSettingMissingError,
  SettingVersionConflictError,
} from './versioned-settings.errors';
import type { Database } from '../../platform/database/connect';
import type { VersionedSetting, VersionedSettingValue } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

export interface CreateSettingVersionInput {
  readonly tenantId: string;
  readonly settingKey: string;
  readonly valueJson: VersionedSettingValue;
  readonly validFrom: Date;
  readonly createdBy?: string | null;
}

/**
 * تنظیمات نسخه‌دار — مقدار هیچ‌وقت overwrite نمی‌شود؛ تنها `validTo` نسخه‌ی
 * باز قبلی در همان transaction بسته می‌شود تا بازه‌ی زمانی قابل بازتولید بماند.
 */
@Injectable()
export class VersionedSettingsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async createVersion(input: CreateSettingVersionInput): Promise<VersionedSetting> {
    return withTenantTransaction(this.db, input.tenantId, (transaction) =>
      this.createVersionInTransaction(transaction, input),
    );
  }

  async createVersionInTransaction(
    transaction: TenantTransaction,
    input: CreateSettingVersionInput,
  ): Promise<VersionedSetting> {
    /*
     * SELECT FOR UPDATE روی ردیف موجود creation اولیه را serialize نمی‌کند.
     * قفل advisory تراکنشی بر کلید `(tenant, settingKey)` هم آن حالت و هم
     * تغییر هم‌زمان نسخه‌ی باز را در یک ترتیب قطعی می‌نشاند.
     */
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:${input.settingKey}`}, 0))`,
    );

    const [latest] = await transaction
      .select()
      .from(versionedSettings)
      .where(
        and(
          eq(versionedSettings.tenantId, input.tenantId),
          eq(versionedSettings.settingKey, input.settingKey),
        ),
      )
      .orderBy(desc(versionedSettings.version))
      .limit(1);

    if (latest !== undefined) {
      const latestBoundary = latest.validTo ?? latest.validFrom;
      if (input.validFrom.getTime() < latestBoundary.getTime()) {
        throw new InvalidSettingVersionDateError();
      }

      if (latest.validTo === null) {
        if (input.validFrom.getTime() <= latest.validFrom.getTime()) {
          throw new InvalidSettingVersionDateError();
        }

        const [closed] = await transaction
          .update(versionedSettings)
          .set({ validTo: input.validFrom })
          .where(and(eq(versionedSettings.id, latest.id), isNull(versionedSettings.validTo)))
          .returning({ id: versionedSettings.id });

        if (closed === undefined) {
          throw new SettingVersionConflictError();
        }
      }
    }

    const [created] = await transaction
      .insert(versionedSettings)
      .values({
        tenantId: input.tenantId,
        settingKey: input.settingKey,
        valueJson: input.valueJson,
        validFrom: input.validFrom,
        version: (latest?.version ?? 0) + 1,
        createdBy: input.createdBy ?? null,
      })
      .returning();

    const setting = created!;
    await this.audit.recordInTransaction(transaction, {
      tenantId: input.tenantId,
      actorUserId: input.createdBy ?? null,
      action: 'SETTING_VERSION_CREATED',
      entityType: 'versioned_setting',
      entityId: setting.id,
      beforeData:
        latest === undefined
          ? undefined
          : { id: latest.id, valueJson: latest.valueJson, validTo: latest.validTo?.toISOString() },
      afterData: {
        id: setting.id,
        valueJson: setting.valueJson,
        validFrom: setting.validFrom.toISOString(),
        version: setting.version.toString(),
      },
    });

    return setting;
  }

  async getEffective(
    tenantId: string,
    settingKey: string,
    effectiveAt: Date,
  ): Promise<VersionedSetting | undefined> {
    return withTenantTransaction(this.db, tenantId, (transaction) =>
      this.getEffectiveInTransaction(transaction, tenantId, settingKey, effectiveAt),
    );
  }

  /**
   * Required domain settings must fail loudly when absent. A caller must never
   * quietly replace an absent historical value with a code-level default.
   */
  async getRequiredEffective(
    tenantId: string,
    settingKey: string,
    effectiveAt: Date,
  ): Promise<VersionedSetting> {
    const setting = await this.getEffective(tenantId, settingKey, effectiveAt);
    if (setting === undefined) {
      throw new RequiredSettingMissingError(settingKey);
    }

    return setting;
  }

  async getEffectiveInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    settingKey: string,
    effectiveAt: Date,
  ): Promise<VersionedSetting | undefined> {
    const [setting] = await transaction
      .select()
      .from(versionedSettings)
      .where(
        and(
          eq(versionedSettings.tenantId, tenantId),
          eq(versionedSettings.settingKey, settingKey),
          lte(versionedSettings.validFrom, effectiveAt),
          or(isNull(versionedSettings.validTo), gt(versionedSettings.validTo, effectiveAt)),
        ),
      )
      .orderBy(desc(versionedSettings.validFrom))
      .limit(1);

    return setting;
  }
}
