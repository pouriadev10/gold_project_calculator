export class LedgerAccountPartyNotFoundError extends Error {
  constructor(partyId: string) {
    super(`Party ${partyId} is not available in the current tenant`);
    this.name = 'LedgerAccountPartyNotFoundError';
  }
}

export class RequiredSystemLedgerAccountNotFoundError extends Error {
  constructor(tenantId: string, systemKey: string) {
    super(`Required ledger account ${systemKey} is missing for tenant ${tenantId}`);
    this.name = 'RequiredSystemLedgerAccountNotFoundError';
  }
}
