import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { VersionedSettingsService } from '../src/modules/pricing/versioned-settings.service';
import { DRIZZLE } from '../src/platform/database/database.module';
import { auditLogs, tenants, versionedSettings } from '../src/platform/database/schema';
import { withTenantTransaction } from '../src/platform/database/tenant-transaction';
import { TenantService } from '../src/platform/tenant/tenant.service';
import { RequiredSettingMissingError } from '../src/modules/pricing/versioned-settings.errors';
import type { Database } from '../src/platform/database/connect';
import type { INestApplicationContext } from '@nestjs/common';

const EXPECTED_SETTINGS: Readonly<Record<string, { readonly value: string }>> = {
  'pricing.base_quote_karat': { value: '705' },
  'pricing.mithqal_grams': { value: '4.6083' },
  'purchase.second_hand_default_karat': { value: '740' },
  'pricing.rial_rounding_unit': { value: '1000' },
  'pricing.rounding_policy': { value: 'HALF_UP' },
  'reporting.default_display_karat': { value: '750' },
  'sales.invoice_correction_window_minutes': { value: '30' },
  'sales.manager_approval_variance_rial': { value: '0' },
  'tax.gold_jewelry_labor_profit_commission_rate_bps': { value: '1000' },
};

describe('tenant initial settings (BE-019)', () => {
  let app: INestApplicationContext;
  let db: Database;
  let tenantService: TenantService;
  let settingsService: VersionedSettingsService;
  const createdTenantIds: string[] = [];

  const createTenant = async () => {
    const tenant = await tenantService.create({
      name: 'تنظیمات اولیه',
      slug: `initial-settings-${randomUUID().slice(0, 12)}`,
    });
    createdTenantIds.push(tenant.id);
    return tenant;
  };

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = app.get<Database>(DRIZZLE);
    tenantService = app.get(TenantService);
    settingsService = app.get(VersionedSettingsService);
  });

  afterAll(async () => {
    for (const tenantId of createdTenantIds) {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await app.close();
  });

  it('creates every required version-one setting in the tenant creation transaction', async () => {
    const tenant = await createTenant();
    const seeded = await withTenantTransaction(db, tenant.id, async (transaction) => ({
      settings: await transaction
        .select()
        .from(versionedSettings)
        .where(eq(versionedSettings.tenantId, tenant.id)),
      audit: await transaction
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.tenantId, tenant.id)),
    }));
    const { settings } = seeded;

    expect(settings).toHaveLength(Object.keys(EXPECTED_SETTINGS).length);
    expect(
      Object.fromEntries(settings.map((setting) => [setting.settingKey, setting.valueJson])),
    ).toEqual(EXPECTED_SETTINGS);
    expect(settings.every((setting) => setting.version === 1 && setting.validTo === null)).toBe(true);
    expect(settings.every((setting) => setting.validFrom.getTime() === tenant.createdAt.getTime())).toBe(
      true,
    );
    expect(seeded.audit).toHaveLength(Object.keys(EXPECTED_SETTINGS).length);
    expect(seeded.audit.every((entry) => entry.action === 'SETTING_VERSION_CREATED')).toBe(true);
  });

  it('uses historical seeded values after a later version is created', async () => {
    const tenant = await createTenant();
    const later = new Date(tenant.createdAt.getTime() + 60_000);

    await settingsService.createVersion({
      tenantId: tenant.id,
      settingKey: 'pricing.base_quote_karat',
      valueJson: { value: '750' },
      validFrom: later,
    });

    const historic = await settingsService.getRequiredEffective(
      tenant.id,
      'pricing.base_quote_karat',
      tenant.createdAt,
    );
    const current = await settingsService.getRequiredEffective(
      tenant.id,
      'pricing.base_quote_karat',
      later,
    );

    expect(historic.valueJson).toEqual({ value: '705' });
    expect(historic.validTo?.getTime()).toBe(later.getTime());
    expect(current.version).toBe(2);
    expect(current.valueJson).toEqual({ value: '750' });
  });

  it('raises a clear domain error instead of falling back when a required setting is absent', async () => {
    const tenant = await createTenant();

    await withTenantTransaction(db, tenant.id, (transaction) =>
      transaction
        .delete(versionedSettings)
        .where(
          and(
            eq(versionedSettings.tenantId, tenant.id),
            eq(versionedSettings.settingKey, 'pricing.base_quote_karat'),
          ),
        ),
    );

    await expect(
      settingsService.getRequiredEffective(tenant.id, 'pricing.base_quote_karat', tenant.createdAt),
    ).rejects.toMatchObject({
      name: RequiredSettingMissingError.name,
      settingKey: 'pricing.base_quote_karat',
    });
  });
});
