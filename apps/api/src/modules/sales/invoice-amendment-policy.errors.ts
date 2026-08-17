export class InvoiceAmendmentPolicyInvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceAmendmentPolicyInvalidInputError';
  }
}

export class InvoiceAmendmentPolicySettingInvalidError extends Error {
  readonly settingKey: string;

  constructor(settingKey: string) {
    super(`The effective setting "${settingKey}" is missing or invalid for invoice amendments`);
    this.name = 'InvoiceAmendmentPolicySettingInvalidError';
    this.settingKey = settingKey;
  }
}

export class InvoiceAmendmentPolicyDeniedError extends Error {
  readonly restrictions: readonly InvoiceAmendmentRestriction[];

  constructor(restrictions: readonly InvoiceAmendmentRestriction[]) {
    super('Invoice amendment requires Manager or Owner authorization');
    this.name = 'InvoiceAmendmentPolicyDeniedError';
    this.restrictions = restrictions;
  }
}

export type InvoiceAmendmentRestriction =
  | 'OUTSIDE_CORRECTION_WINDOW'
  | 'BUSINESS_DAY_CLOSED'
  | 'SETTLED_INVOICE'
  | 'VARIANCE_EXCEEDS_MANAGER_THRESHOLD';
