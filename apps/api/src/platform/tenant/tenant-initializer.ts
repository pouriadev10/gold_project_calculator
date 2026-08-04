import type { TenantTransaction } from '../database/tenant-transaction';

/**
 * Port for data that must exist before a new tenant can be used. Platform code
 * owns the lifecycle, while a domain module owns the domain-specific seed data.
 */
export const TENANT_INITIALIZER = Symbol('TENANT_INITIALIZER');

export interface TenantInitializationInput {
  readonly tenantId: string;
  readonly validFrom: Date;
}

export interface TenantInitializer {
  initializeInTransaction(
    transaction: TenantTransaction,
    input: TenantInitializationInput,
  ): Promise<void>;
}

/** Executes each domain-owned seed step in the same tenant-creation transaction. */
export class CompositeTenantInitializer implements TenantInitializer {
  constructor(private readonly initializers: readonly TenantInitializer[]) {}

  async initializeInTransaction(
    transaction: TenantTransaction,
    input: TenantInitializationInput,
  ): Promise<void> {
    for (const initializer of this.initializers) {
      await initializer.initializeInTransaction(transaction, input);
    }
  }
}
