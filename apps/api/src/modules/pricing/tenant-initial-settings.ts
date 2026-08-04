import type { VersionedSettingValue } from '../../platform/database/schema';

export interface InitialTenantSetting {
  readonly settingKey: string;
  readonly valueJson: VersionedSettingValue;
}

/**
 * Phase-1 defaults are seed data, never runtime fallbacks. Numeric values stay
 * strings so they remain safe in JSON and can later be read as BigInt/decimal
 * without passing through a JavaScript number.
 *
 * The VAT setting applies only to jewelry making charges, profit, and
 * commission; the underlying gold value is not part of its tax base.
 */
export const INITIAL_TENANT_SETTINGS = [
  { settingKey: 'pricing.base_quote_karat', valueJson: { value: '705' } },
  { settingKey: 'pricing.mithqal_grams', valueJson: { value: '4.6083' } },
  { settingKey: 'purchase.second_hand_default_karat', valueJson: { value: '740' } },
  { settingKey: 'pricing.rial_rounding_unit', valueJson: { value: '1000' } },
  { settingKey: 'pricing.rounding_policy', valueJson: { value: 'HALF_UP' } },
  { settingKey: 'reporting.default_display_karat', valueJson: { value: '750' } },
  { settingKey: 'sales.invoice_correction_window_minutes', valueJson: { value: '30' } },
  {
    settingKey: 'sales.manager_approval_variance_rial',
    valueJson: { value: '0' },
  },
  {
    settingKey: 'tax.gold_jewelry_labor_profit_commission_rate_bps',
    valueJson: { value: '1000' },
  },
] as const satisfies readonly InitialTenantSetting[];

export const REQUIRED_TENANT_SETTING_KEYS = INITIAL_TENANT_SETTINGS.map(
  ({ settingKey }) => settingKey,
);
