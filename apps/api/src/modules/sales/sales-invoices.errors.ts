/** فاکتور در این tenant وجود ندارد. */
export class SalesInvoiceNotFoundError extends Error {
  readonly salesInvoiceId: string;

  constructor(salesInvoiceId: string) {
    super(`Sales invoice "${salesInvoiceId}" is not available to this tenant`);
    this.name = 'SalesInvoiceNotFoundError';
    this.salesInvoiceId = salesInvoiceId;
  }
}

/** فقط فاکتورِ در وضعیت DRAFT قابل finalize شدن است. */
export class SalesInvoiceNotDraftError extends Error {
  readonly salesInvoiceId: string;

  constructor(salesInvoiceId: string) {
    super(`Sales invoice "${salesInvoiceId}" is not in DRAFT status`);
    this.name = 'SalesInvoiceNotDraftError';
    this.salesInvoiceId = salesInvoiceId;
  }
}

/** یک فاکتور بدون حداقل یک ردیف قابل finalize شدن نیست. */
export class SalesInvoiceRequiresItemsError extends Error {
  constructor() {
    super('Sales invoice must have at least one item to finalize');
    this.name = 'SalesInvoiceRequiresItemsError';
  }
}
