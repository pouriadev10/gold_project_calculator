import { ResourceNotFoundError } from '../../platform/error-contract/resource-not-found.error';
import { BusinessRuleError } from '../../platform/error-contract/business-rule.error';

export class SalesPricingQuoteNotFoundError extends ResourceNotFoundError {
  constructor() {
    super('The selected mazneh quote is not available to this tenant');
    this.name = 'SalesPricingQuoteNotFoundError';
  }
}

export class SalesPricingSettingInvalidError extends Error {
  readonly settingKey: string;

  constructor(settingKey: string) {
    super(`The effective setting "${settingKey}" is missing or invalid for sales pricing`);
    this.name = 'SalesPricingSettingInvalidError';
    this.settingKey = settingKey;
  }
}

/** دفاع در برابر فراخوان داخلی که از Zod عبور نکرده — نه پاسخ به ورودی HTTP معمول. */
export class SalesPricingInvalidCoinInputError extends BusinessRuleError {
  constructor(message: string) {
    super(message, 'اطلاعات فروش سکه معتبر نیست');
    this.name = 'SalesPricingInvalidCoinInputError';
  }
}
