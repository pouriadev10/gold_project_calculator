export class SecondHandPurchasePartyNotFoundError extends Error {
  constructor() {
    super('An active consumer party is required for a second-hand purchase');
    this.name = 'SecondHandPurchasePartyNotFoundError';
  }
}

export class SecondHandPurchasePartyNotConsumerError extends Error {
  constructor() {
    super('Second-hand purchases in phase 1 are limited to consumer parties');
    this.name = 'SecondHandPurchasePartyNotConsumerError';
  }
}

export class SecondHandPurchaseQuoteNotFoundError extends Error {
  constructor() {
    super('A positive MAZNEH quote from the current tenant is required');
    this.name = 'SecondHandPurchaseQuoteNotFoundError';
  }
}

export class SecondHandPurchasePricingSettingInvalidError extends Error {
  constructor(readonly settingKey: string) {
    super(`Second-hand purchase requires a valid historical setting for "${settingKey}"`);
    this.name = 'SecondHandPurchasePricingSettingInvalidError';
  }
}

export class SecondHandPurchasePaidRialExceedsAmountError extends Error {
  constructor() {
    super('Paid Rial cannot exceed the calculated second-hand purchase amount');
    this.name = 'SecondHandPurchasePaidRialExceedsAmountError';
  }
}

export class SecondHandPurchaseCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecondHandPurchaseCalculationError';
  }
}

export class SecondHandCoinPurchaseInvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecondHandCoinPurchaseInvalidInputError';
  }
}
