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
