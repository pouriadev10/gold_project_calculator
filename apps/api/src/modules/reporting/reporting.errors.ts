export class ReportingReferenceQuoteNotFoundError extends Error {
  constructor() {
    super('Reference mazneh was not found');
  }
}

export class ReportingDisplaySettingInvalidError extends Error {
  constructor(settingKey: string) {
    super(`Reporting display setting '${settingKey}' is invalid`);
  }
}
