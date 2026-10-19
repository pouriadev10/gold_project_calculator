import { ResourceNotFoundError } from '../error-contract/resource-not-found.error';

export class TenantExportNotFoundError extends ResourceNotFoundError {
  constructor(exportId: string) {
    super(`Tenant export ${exportId} was not found`);
    this.name = 'TenantExportNotFoundError';
  }
}
