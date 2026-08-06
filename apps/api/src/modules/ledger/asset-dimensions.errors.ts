export class RequiredAssetDimensionNotFoundError extends Error {
  constructor(tenantId: string, kind: 'GOLD' | 'COIN', coinTypeId?: string) {
    super(
      coinTypeId === undefined
        ? `Required ${kind} asset dimension is missing for tenant ${tenantId}`
        : `Required ${kind} asset dimension for coin type ${coinTypeId} is missing for tenant ${tenantId}`,
    );
    this.name = 'RequiredAssetDimensionNotFoundError';
  }
}
