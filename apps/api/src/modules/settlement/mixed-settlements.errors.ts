import { ResourceNotFoundError } from '../../platform/error-contract/resource-not-found.error';
import { BusinessRuleError } from '../../platform/error-contract/business-rule.error';

export class MixedSettlementInvalidInputError extends BusinessRuleError {
  constructor(message: string) {
    super(message, 'اطلاعات تسویه‌ی ترکیبی معتبر نیست');
    this.name = 'MixedSettlementInvalidInputError';
  }
}

export class MixedSettlementQuoteNotFoundError extends ResourceNotFoundError {
  constructor() {
    super(
      'A positive MAZNEH quote from the current tenant is required for a mixed settlement conversion',
    );
    this.name = 'MixedSettlementQuoteNotFoundError';
  }
}

export class MixedSettlementPricingSettingInvalidError extends Error {
  readonly settingKey: string;

  constructor(settingKey: string) {
    super(`Mixed settlement requires a valid historical setting for "${settingKey}"`);
    this.name = 'MixedSettlementPricingSettingInvalidError';
    this.settingKey = settingKey;
  }
}

export class MixedSettlementInsufficientCreditError extends BusinessRuleError {
  readonly availableRial: bigint;
  readonly requestedRial: bigint;

  constructor(availableRial: bigint, requestedRial: bigint) {
    super('The party does not have enough RIAL credit to apply this settlement line', 'اعتبار ریالی این شخص برای این ردیف کافی نیست');
    this.name = 'MixedSettlementInsufficientCreditError';
    this.availableRial = availableRial;
    this.requestedRial = requestedRial;
  }
}
