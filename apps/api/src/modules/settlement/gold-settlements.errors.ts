export class GoldSettlementQuoteNotFoundError extends Error {
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

export class GoldSettlementPureWeightZeroError extends Error {
  constructor() {
    super('Gold settlement weight becomes zero after karat normalization');
    this.name = 'GoldSettlementPureWeightZeroError';
  }
}
