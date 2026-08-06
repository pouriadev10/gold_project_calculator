/** ورودی posting پیش از رسیدن به هر جدول مالی نامعتبر است. */
export class InvalidLedgerPostingError extends Error {
  constructor(reason: string) {
    super(`Invalid ledger posting: ${reason}`);
    this.name = 'InvalidLedgerPostingError';
  }
}

/** حساب در tenant جاری وجود ندارد؛ شامل حساب tenant دیگر هم می‌شود. */
export class LedgerPostingAccountNotFoundError extends Error {
  readonly accountId: string;

  constructor(accountId: string) {
    super(`Ledger account "${accountId}" is not available to this tenant`);
    this.name = 'LedgerPostingAccountNotFoundError';
    this.accountId = accountId;
  }
}

/** بُعد در tenant جاری وجود ندارد؛ شامل بُعد tenant دیگر هم می‌شود. */
export class LedgerPostingDimensionNotFoundError extends Error {
  readonly dimensionId: string;

  constructor(dimensionId: string) {
    super(`Asset dimension "${dimensionId}" is not available to this tenant`);
    this.name = 'LedgerPostingDimensionNotFoundError';
    this.dimensionId = dimensionId;
  }
}

/** حساب غیرفعال فقط برای تاریخچه باقی می‌ماند و entry جدید نمی‌پذیرد. */
export class InactiveLedgerPostingAccountError extends Error {
  readonly accountId: string;

  constructor(accountId: string) {
    super(`Ledger account "${accountId}" is inactive`);
    this.name = 'InactiveLedgerPostingAccountError';
    this.accountId = accountId;
  }
}

/** بُعد غیرفعال (برای نمونه سکه‌ی از رده خارج) entry عملیاتی جدید نمی‌پذیرد. */
export class InactiveLedgerPostingDimensionError extends Error {
  readonly dimensionId: string;

  constructor(dimensionId: string) {
    super(`Asset dimension "${dimensionId}" is inactive`);
    this.name = 'InactiveLedgerPostingDimensionError';
    this.dimensionId = dimensionId;
  }
}

/** مجموع signed quantity یک بُعد پیش از insert صفر نیست. */
export class UnbalancedLedgerPostingError extends Error {
  readonly dimensionId: string;
  readonly total: bigint;

  constructor(dimensionId: string, total: bigint) {
    super(
      `Ledger posting is not balanced in dimension "${dimensionId}": ${total.toString()}`,
    );
    this.name = 'UnbalancedLedgerPostingError';
    this.dimensionId = dimensionId;
    this.total = total;
  }
}
