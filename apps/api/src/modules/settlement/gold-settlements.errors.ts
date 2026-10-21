import { ResourceNotFoundError } from '../../platform/error-contract/resource-not-found.error';
import { BusinessRuleError } from '../../platform/error-contract/business-rule.error';

export class GoldSettlementQuoteNotFoundError extends ResourceNotFoundError {
  constructor() {
    super('A positive MAZNEH quote from the current tenant is required for a gold settlement');
    this.name = 'GoldSettlementQuoteNotFoundError';
  }
}

export class GoldSettlementPricingSettingInvalidError extends Error {
  readonly settingKey: string;

  constructor(settingKey: string) {
    super(`Gold settlement requires a valid historical setting for "${settingKey}"`);
    this.name = 'GoldSettlementPricingSettingInvalidError';
    this.settingKey = settingKey;
  }
}

export class GoldSettlementPureWeightZeroError extends BusinessRuleError {
  constructor() {
    super('Gold settlement weight becomes zero after karat normalization', 'وزن خالص این طلا پس از اعمال عیار صفر می‌شود');
    this.name = 'GoldSettlementPureWeightZeroError';
  }
}
