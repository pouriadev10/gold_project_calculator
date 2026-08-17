export class SalesInvoiceAmendmentNotFinalizedError extends Error {
  constructor() {
    super('Only finalized sales invoices can be amended');
    this.name = 'SalesInvoiceAmendmentNotFinalizedError';
  }
}

export class SalesInvoiceAmendmentSnapshotInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalesInvoiceAmendmentSnapshotInvalidError';
  }
}

export class SalesInvoiceAmendmentPaidRialExceedsPayableError extends Error {
  constructor() {
    super('Amendment paid Rial cannot exceed the recalculated payable amount');
    this.name = 'SalesInvoiceAmendmentPaidRialExceedsPayableError';
  }
}

export class SalesInvoiceAmendmentUnsupportedItemsError extends Error {
  constructor() {
    super('The current invoice shape cannot be amended by the phase-one endpoint');
    this.name = 'SalesInvoiceAmendmentUnsupportedItemsError';
  }
}
