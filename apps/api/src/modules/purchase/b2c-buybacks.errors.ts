export class B2cBuybackInvoiceNotFoundError extends Error {
  constructor() {
    super('The source sales invoice is not available to this tenant');
    this.name = 'B2cBuybackInvoiceNotFoundError';
  }
}

export class B2cBuybackInvoiceNotFinalizedError extends Error {
  constructor() {
    super('Only a finalized sales invoice can be used for a B2C buyback');
    this.name = 'B2cBuybackInvoiceNotFinalizedError';
  }
}

export class B2cBuybackPartyNotAvailableError extends Error {
  constructor() {
    super('The source invoice party is no longer active for a new purchase');
    this.name = 'B2cBuybackPartyNotAvailableError';
  }
}

export class B2cBuybackPartyNotConsumerError extends Error {
  constructor() {
    super('B2C buyback is available only when the source invoice party is a consumer');
    this.name = 'B2cBuybackPartyNotConsumerError';
  }
}

export class B2cBuybackSourceItemsUnsupportedError extends Error {
  constructor() {
    super('A B2C buyback source invoice must have exactly one jewelry item');
    this.name = 'B2cBuybackSourceItemsUnsupportedError';
  }
}

export class B2cBuybackSourceSnapshotInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'B2cBuybackSourceSnapshotInvalidError';
  }
}

export class B2cBuybackSourceSnapshotMismatchError extends Error {
  constructor() {
    super('The source invoice snapshots cannot reproduce its original payable amount');
    this.name = 'B2cBuybackSourceSnapshotMismatchError';
  }
}
