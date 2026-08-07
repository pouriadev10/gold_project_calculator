/** تراکنش مبدأ برای reversal در این tenant وجود ندارد. */
export class LedgerTransactionNotFoundError extends Error {
  readonly transactionId: string;

  constructor(transactionId: string) {
    super(`Ledger transaction "${transactionId}" is not available to this tenant`);
    this.name = 'LedgerTransactionNotFoundError';
    this.transactionId = transactionId;
  }
}
