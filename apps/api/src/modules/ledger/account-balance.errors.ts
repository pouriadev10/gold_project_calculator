/** حساب در tenant جاری وجود ندارد؛ شامل حساب tenant دیگر هم می‌شود. */
export class LedgerAccountNotFoundError extends Error {
  readonly accountId: string;

  constructor(accountId: string) {
    super(`Ledger account "${accountId}" is not available to this tenant`);
    this.name = 'LedgerAccountNotFoundError';
    this.accountId = accountId;
  }
}
