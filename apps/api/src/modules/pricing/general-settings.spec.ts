import 'reflect-metadata';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { updateGeneralSettingSchema } from '@gold/contracts';
import { ROLES_METADATA_KEY } from '../../platform/auth/roles.decorator';
import { IdempotencyKeyConflictError } from '../../platform/idempotency/idempotency.errors';
import { GeneralSettingsController } from './general-settings.controller';
import { GeneralSettingsService, GeneralSettingValueShapeError, toGeneralSetting } from './general-settings.service';
import { InvalidSettingVersionDateError, RequiredSettingMissingError } from './versioned-settings.errors';
import type { VersionedSettingsService } from './versioned-settings.service';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service';
import type { RequestContextService } from '../../platform/request-context/request-context.service';
import type { Database } from '../../platform/database/connect';
import type { VersionedSetting } from '../../platform/database/schema';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

/** FE-080 — API نازک تنظیمات عمومی مستأجر روی تنظیمات نسخه‌دار. */

const TENANT = 'a0000000-0000-4000-8000-000000000001';
const USER = 'b0000000-0000-4000-8000-000000000001';
const VALID_FROM = new Date('2026-10-01T00:00:00.000Z');

function row(settingKey: string, value: unknown, version = 1): VersionedSetting {
  return {
    id: 'c0000000-0000-4000-8000-000000000001',
    tenantId: TENANT,
    settingKey,
    valueJson: { value } as VersionedSetting['valueJson'],
    validFrom: VALID_FROM,
    validTo: null,
    version,
    createdBy: null,
    createdAt: VALID_FROM,
  } as VersionedSetting;
}

const transaction = {} as TenantTransaction;

describe('GeneralSettingsService', () => {
  it('maps the effective version of every general key, in contract order', async () => {
    const getEffectiveInTransaction = vi.fn(async (_tx: unknown, _tenant: string, key: string) =>
      row(key, key === 'pricing.rounding_policy' ? 'HALF_UP' : '740', 3),
    );
    const service = new GeneralSettingsService({} as Database, {
      getEffectiveInTransaction,
    } as unknown as VersionedSettingsService);

    const at = new Date('2026-10-10T08:00:00.000Z');
    const result = await service.listInTransaction(transaction, TENANT, at);

    expect(result.settings.map((setting) => setting.key)).toEqual([
      'purchase.second_hand_default_karat',
      'pricing.rial_rounding_unit',
      'pricing.rounding_policy',
      'reporting.default_display_karat',
      'sales.invoice_correction_window_minutes',
      'sales.manager_approval_variance_rial',
    ]);
    expect(result.settings[2]).toEqual({
      key: 'pricing.rounding_policy',
      value: 'HALF_UP',
      version: 3,
      validFrom: VALID_FROM.toISOString(),
      createdBy: null,
    });
    expect(getEffectiveInTransaction).toHaveBeenCalledWith(transaction, TENANT, 'pricing.rial_rounding_unit', at);
  });

  it('fails loudly instead of inventing a default when a required setting is missing', async () => {
    const service = new GeneralSettingsService({} as Database, {
      getEffectiveInTransaction: vi.fn(async () => undefined),
    } as unknown as VersionedSettingsService);
    await expect(service.listInTransaction(transaction, TENANT, new Date())).rejects.toBeInstanceOf(
      RequiredSettingMissingError,
    );
  });

  it('creates a new version starting now, recording who changed it', async () => {
    const createVersionInTransaction = vi.fn(async () => row('pricing.rial_rounding_unit', '10000', 2));
    const service = new GeneralSettingsService({} as Database, {
      createVersionInTransaction,
    } as unknown as VersionedSettingsService);
    const at = new Date('2026-10-10T09:00:00.000Z');

    const updated = await service.updateInTransaction(transaction, {
      tenantId: TENANT,
      key: 'pricing.rial_rounding_unit',
      value: '10000',
      createdBy: USER,
      at,
    });

    expect(createVersionInTransaction).toHaveBeenCalledWith(transaction, {
      tenantId: TENANT,
      settingKey: 'pricing.rial_rounding_unit',
      valueJson: { value: '10000' },
      validFrom: at,
      createdBy: USER,
    });
    expect(updated).toMatchObject({ key: 'pricing.rial_rounding_unit', value: '10000', version: 2 });
  });

  it('rejects a stored value that is not a string', () => {
    expect(() => toGeneralSetting('pricing.rial_rounding_unit', row('pricing.rial_rounding_unit', 1000))).toThrow(
      GeneralSettingValueShapeError,
    );
  });
});

describe('updateGeneralSettingSchema — same rules the consuming services enforce', () => {
  it.each([
    ['purchase.second_hand_default_karat', '740', true],
    ['purchase.second_hand_default_karat', '0', false],
    ['purchase.second_hand_default_karat', '1001', false],
    ['reporting.default_display_karat', '7.5', false],
    ['pricing.rial_rounding_unit', '1000', true],
    ['pricing.rial_rounding_unit', '0', false],
    ['pricing.rial_rounding_unit', '-10', false],
    ['pricing.rounding_policy', 'HALF_UP', true],
    ['pricing.rounding_policy', 'HALF_EVEN', false],
    ['sales.invoice_correction_window_minutes', '0', true],
    ['sales.invoice_correction_window_minutes', '525601', false],
    ['sales.manager_approval_variance_rial', '0', true],
    ['sales.manager_approval_variance_rial', '1e6', false],
  ] as const)('%s = %s → %s', (key, value, ok) => {
    expect(updateGeneralSettingSchema.safeParse({ key, value }).success).toBe(ok);
  });

  it('rejects unknown keys and extra fields', () => {
    expect(updateGeneralSettingSchema.safeParse({ key: 'tax.rate', value: '1' }).success).toBe(false);
    expect(
      updateGeneralSettingSchema.safeParse({ key: 'pricing.rial_rounding_unit', value: '1', validFrom: 'x' }).success,
    ).toBe(false);
  });
});

describe('GeneralSettingsController', () => {
  const auth = { sub: USER, tid: TENANT, role: 'MANAGER' as const };
  const context = { getTenantId: () => TENANT } as RequestContextService;

  it('lets every role read but only OWNER and MANAGER change', () => {
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, GeneralSettingsController.prototype.list)).toEqual([
      'OWNER',
      'MANAGER',
      'CASHIER',
    ]);
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, GeneralSettingsController.prototype.update)).toEqual([
      'OWNER',
      'MANAGER',
    ]);
  });

  it('creates the version through the idempotency gate with the caller as author', async () => {
    const updateInTransaction = vi.fn(async () => ({
      key: 'pricing.rial_rounding_unit' as const,
      value: '10000',
      version: 2,
      validFrom: VALID_FROM.toISOString(),
      createdBy: USER,
    }));
    const execute = vi.fn(async (input: { execute: (tx: TenantTransaction) => Promise<{ body: unknown }> }) => ({
      response: await input.execute(transaction),
    }));
    const controller = new GeneralSettingsController(
      context,
      { execute } as unknown as IdempotencyService,
      { updateInTransaction } as unknown as GeneralSettingsService,
    );

    const result = await controller.update({ key: 'pricing.rial_rounding_unit', value: '10000' }, auth, 'key-1');

    expect(result).toMatchObject({ value: '10000', version: 2 });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, key: 'key-1', request: expect.objectContaining({ path: '/settings/general' }) }),
    );
    expect(updateInTransaction).toHaveBeenCalledWith(transaction, {
      tenantId: TENANT,
      key: 'pricing.rial_rounding_unit',
      value: '10000',
      createdBy: USER,
    });
  });

  it('requires authentication and maps version/idempotency conflicts to 409', async () => {
    const failWith = (error: Error) =>
      new GeneralSettingsController(
        context,
        { execute: vi.fn(async () => Promise.reject(error)) } as unknown as IdempotencyService,
        {} as GeneralSettingsService,
      );
    const body = { key: 'pricing.rial_rounding_unit' as const, value: '1000' };

    await expect(failWith(new Error('x')).update(body, undefined, 'k')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(failWith(new InvalidSettingVersionDateError()).update(body, auth, 'k')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(failWith(new IdempotencyKeyConflictError()).update(body, auth, 'k')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
