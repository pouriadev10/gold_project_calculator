export class SalesPricingQuoteNotFoundError extends Error {
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
