export class OpeningBalanceCoinTypeUnavailableError extends Error {
  readonly coinTypeId: string;

  constructor(coinTypeId: string) {
    super(`Coin type "${coinTypeId}" is not active at the opening balance effective time`);
    this.name = 'OpeningBalanceCoinTypeUnavailableError';
    this.coinTypeId = coinTypeId;
  }
}

export class OpeningBalanceJewelryPureWeightZeroError extends Error {
  readonly jewelryItemId: string;

  constructor(jewelryItemId: string) {
    super(`Jewelry item "${jewelryItemId}" has zero pure-gold weight at milligram precision`);
    this.name = 'OpeningBalanceJewelryPureWeightZeroError';
    this.jewelryItemId = jewelryItemId;
  }
}
