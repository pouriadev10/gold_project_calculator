import { ResourceNotFoundError } from '../../platform/error-contract/resource-not-found.error';

/** شخصی که کلاینت فرستاده در این مستأجر نیست — مثل بقیه‌ی ارجاع‌های ورودی ۴۰۴ (M-09). */
export class LedgerAccountPartyNotFoundError extends ResourceNotFoundError {
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
