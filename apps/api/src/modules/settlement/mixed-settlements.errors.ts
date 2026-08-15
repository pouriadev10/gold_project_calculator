export class MixedSettlementInvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MixedSettlementInvalidInputError';
  }
}

export class MixedSettlementQuoteNotFoundError extends Error {
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

export class MixedSettlementInsufficientCreditError extends Error {
  readonly availableRial: bigint;
  readonly requestedRial: bigint;

  constructor(availableRial: bigint, requestedRial: bigint) {
    super('The party does not have enough RIAL credit to apply this settlement line');
    this.name = 'MixedSettlementInsufficientCreditError';
    this.availableRial = availableRial;
    this.requestedRial = requestedRial;
  }
}
