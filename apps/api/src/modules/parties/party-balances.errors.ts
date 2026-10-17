import { ResourceNotFoundError } from '../../platform/error-contract/resource-not-found.error';

export class PartyBalanceReferenceQuoteNotFoundError extends ResourceNotFoundError {
  constructor() {
    super('The selected reference mazneh is not available in the current tenant');
    this.name = 'PartyBalanceReferenceQuoteNotFoundError';
  }
}

export class PartyBalanceDisplaySettingInvalidError extends Error {
  constructor(settingKey: string) {
    super(`The display conversion setting "${settingKey}" is missing or invalid`);
    this.name = 'PartyBalanceDisplaySettingInvalidError';
  }
}

export class PartyBalanceCoinTypeNotFoundError extends ResourceNotFoundError {
  constructor(code: string) {
    super(`The ledger coin dimension "${code}" has no coin type in the current tenant`);
    this.name = 'PartyBalanceCoinTypeNotFoundError';
  }
}
