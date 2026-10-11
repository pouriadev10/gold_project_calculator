import { Inject, Injectable } from '@nestjs/common';
import { generalSettingKeySchema } from '@gold/contracts';
import { DRIZZLE } from '../../platform/database/database.module';
import { withTenantTransaction } from '../../platform/database/tenant-transaction';
import { RequiredSettingMissingError } from './versioned-settings.errors';
import { VersionedSettingsService } from './versioned-settings.service';
import type { GeneralSetting, GeneralSettingKey, GeneralSettings } from '@gold/contracts';
import type { Database } from '../../platform/database/connect';
import type { VersionedSetting, VersionedSettingValue } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

/** مقدار ذخیره‌شده‌ی یک تنظیم شکل `{ value: string }` ندارد. */
export class GeneralSettingValueShapeError extends Error {
  constructor(settingKey: string) {
    super(`Tenant setting "${settingKey}" does not hold a string value`);
    this.name = 'GeneralSettingValueShapeError';
  }
}

function stringValue(valueJson: VersionedSettingValue, settingKey: string): string {
  if (valueJson !== null && typeof valueJson === 'object' && !Array.isArray(valueJson)) {
    const value = (valueJson as Readonly<Record<string, VersionedSettingValue>>)['value'];
    if (typeof value === 'string') return value;
  }
  throw new GeneralSettingValueShapeError(settingKey);
}

export function toGeneralSetting(key: GeneralSettingKey, setting: VersionedSetting): GeneralSetting {
  return {
    key,
    value: stringValue(setting.valueJson, key),
    version: setting.version,
    validFrom: setting.validFrom.toISOString(),
    createdBy: setting.createdBy,
  };
}

/**
 * تنظیمات عمومی مستأجر — FE-080. لایه‌ی نازک روی `VersionedSettingsService`:
 * خواندن مقدار مؤثر همین لحظه‌ی شش کلید، و ساخت نسخه‌ی تازه برای یک کلید با
 * شروع اعتبار «اکنون». نسخه‌ی قبلی بسته و audit می‌شود؛ هیچ ردیفی overwrite
 * نمی‌شود و سندهای گذشته که snapshot تنظیمات خودشان را دارند تغییر نمی‌کنند.
 */
@Injectable()
export class GeneralSettingsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(VersionedSettingsService) private readonly settings: VersionedSettingsService,
  ) {}

  async list(tenantId: string, at: Date = new Date()): Promise<GeneralSettings> {
    return withTenantTransaction(this.db, tenantId, (transaction) =>
      this.listInTransaction(transaction, tenantId, at),
    );
  }

  async listInTransaction(
    transaction: TenantTransaction,
    tenantId: string,
    at: Date,
  ): Promise<GeneralSettings> {
    const settings: GeneralSetting[] = [];
    for (const key of generalSettingKeySchema.options) {
      const effective = await this.settings.getEffectiveInTransaction(transaction, tenantId, key, at);
      // تنظیم الزامی است و در seed مستأجر ساخته می‌شود؛ نبودش خطای صریح است، نه پیش‌فرض کد.
      if (effective === undefined) throw new RequiredSettingMissingError(key);
      settings.push(toGeneralSetting(key, effective));
    }
    return { settings };
  }

  async updateInTransaction(
    transaction: TenantTransaction,
    input: {
      readonly tenantId: string;
      readonly key: GeneralSettingKey;
      readonly value: string;
      readonly createdBy: string;
      readonly at?: Date;
    },
  ): Promise<GeneralSetting> {
    const created = await this.settings.createVersionInTransaction(transaction, {
      tenantId: input.tenantId,
      settingKey: input.key,
      valueJson: { value: input.value },
      validFrom: input.at ?? new Date(),
      createdBy: input.createdBy,
    });
    return toGeneralSetting(input.key, created);
  }
}
