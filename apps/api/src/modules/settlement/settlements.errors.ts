export class SettlementNotFoundError extends Error {
  readonly settlementId: string;

  constructor(settlementId: string) {
    super(`Settlement "${settlementId}" is not available to this tenant`);
    this.name = 'SettlementNotFoundError';
    this.settlementId = settlementId;
  }
}

/** فقط تسویه‌ی در وضعیت DRAFT قابل finalize شدن است. */
export class SettlementNotDraftError extends Error {
  readonly settlementId: string;

  constructor(settlementId: string) {
    super(`Settlement "${settlementId}" is not in DRAFT status`);
    this.name = 'SettlementNotDraftError';
    this.settlementId = settlementId;
  }
}

export class SettlementRequiresLinesError extends Error {
  constructor() {
    super('Settlement must have at least one line to finalize');
    this.name = 'SettlementRequiresLinesError';
  }
}

export class InvalidSettlementFinalizeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSettlementFinalizeInputError';
  }
}
