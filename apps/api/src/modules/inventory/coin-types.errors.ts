export class InvalidCoinTypeVersionDateError extends Error {
  constructor() {
    super('Coin type version date must be after the current version start');
    this.name = 'InvalidCoinTypeVersionDateError';
  }
}

export class CoinTypeVersionConflictError extends Error {
  constructor() {
    super('Coin type version changed concurrently; retry the operation');
    this.name = 'CoinTypeVersionConflictError';
  }
}

export class CoinMintTypeMismatchError extends Error {
  constructor() {
    super('Only CENTRAL_BANK coin types may be marked as central-bank minted');
    this.name = 'CoinMintTypeMismatchError';
  }
}

export class CoinTypeNotFoundError extends Error {
  readonly coinTypeId: string;

  constructor(coinTypeId: string) {
    super(`Coin type "${coinTypeId}" was not found for this tenant`);
    this.name = 'CoinTypeNotFoundError';
    this.coinTypeId = coinTypeId;
  }
}

/**
 * نسخه‌ی غیرفعال سکه در معامله‌ی جدید انتخاب شده است — همان معیار BE-026
 * برای کالای زیورآلات، برای سکه.
 */
export class InactiveCoinTypeError extends Error {
  readonly coinTypeId: string;

  constructor(coinTypeId: string) {
    super(`Coin type "${coinTypeId}" is inactive and cannot be used in a new transaction`);
    this.name = 'InactiveCoinTypeError';
    this.coinTypeId = coinTypeId;
  }
}
