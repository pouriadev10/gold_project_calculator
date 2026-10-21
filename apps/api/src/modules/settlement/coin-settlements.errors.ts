import { ResourceNotFoundError } from '../../platform/error-contract/resource-not-found.error';
import { BusinessRuleError } from '../../platform/error-contract/business-rule.error';

export class CoinSettlementQuoteNotFoundError extends ResourceNotFoundError {
  constructor() {
    super('A positive MAZNEH quote from the current tenant is required for a coin settlement');
    this.name = 'CoinSettlementQuoteNotFoundError';
  }
}

export class CoinSettlementPricingSettingInvalidError extends Error {
  readonly settingKey: string;

  constructor(settingKey: string) {
    super(`Coin settlement requires a valid historical setting for "${settingKey}"`);
    this.name = 'CoinSettlementPricingSettingInvalidError';
    this.settingKey = settingKey;
  }
}

export class CoinSettlementInvalidInputError extends BusinessRuleError {
  constructor(message: string) {
    super(message, 'اطلاعات تسویه با سکه معتبر نیست');
    this.name = 'CoinSettlementInvalidInputError';
  }
}
