export class CoinSettlementQuoteNotFoundError extends Error {
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

export class CoinSettlementInvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoinSettlementInvalidInputError';
  }
}
