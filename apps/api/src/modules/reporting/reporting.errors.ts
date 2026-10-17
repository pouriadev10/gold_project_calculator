import { ResourceNotFoundError } from '../../platform/error-contract/resource-not-found.error';

export class ReportingReferenceQuoteNotFoundError extends ResourceNotFoundError {
  constructor() {
    super('Reference mazneh was not found');
  }
}

export class ReportingDisplaySettingInvalidError extends Error {
  constructor(settingKey: string) {
    super(`Reporting display setting '${settingKey}' is invalid`);
  }
}

export class ProfitReportSnapshotInvalidError extends Error {
  constructor(message: string) {
    super(`Profit report cannot read an immutable source snapshot: ${message}`);
  }
}
