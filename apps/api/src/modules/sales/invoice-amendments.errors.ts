import { BusinessRuleError } from '../../platform/error-contract/business-rule.error';

export class SalesInvoiceAmendmentNotFinalizedError extends BusinessRuleError {
  constructor() {
    super('Only finalized sales invoices can be amended', 'فقط فاکتور نهایی‌شده قابل اصلاح است');
    this.name = 'SalesInvoiceAmendmentNotFinalizedError';
  }
}

export class SalesInvoiceAmendmentSnapshotInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalesInvoiceAmendmentSnapshotInvalidError';
  }
}

export class SalesInvoiceAmendmentPaidRialExceedsPayableError extends BusinessRuleError {
  constructor() {
    super('Amendment paid Rial cannot exceed the recalculated payable amount', 'مبلغ پرداختی از مبلغ اصلاح‌شده‌ی فاکتور بیشتر است');
    this.name = 'SalesInvoiceAmendmentPaidRialExceedsPayableError';
  }
}

export class SalesInvoiceAmendmentUnsupportedItemsError extends BusinessRuleError {
  constructor() {
    super('The current invoice shape cannot be amended by the phase-one endpoint', 'این فاکتور با این روش قابل اصلاح نیست');
    this.name = 'SalesInvoiceAmendmentUnsupportedItemsError';
  }
}

/**
 * اصلاحیه‌ای که هیچ اثر مالی ندارد (#46) — مثلاً کالا با کالای هم‌مشخصه جابه‌جا شده.
 * تا تصمیم D-06 رد می‌شود، به‌جای ۵۰۰ ِ سند دفتر کل خالی.
 */
export class SalesInvoiceAmendmentNoFinancialChangeError extends BusinessRuleError {
  constructor() {
    super(
      'The amendment has no ledger effect; an empty ledger posting is not allowed',
      'این اصلاح هیچ اثر مالی ندارد و فعلاً ثبت نمی‌شود',
    );
    this.name = 'SalesInvoiceAmendmentNoFinancialChangeError';
  }
}
