import { Inject, Injectable } from '@nestjs/common';
import { AssetDimensionsService } from './asset-dimensions.service';
import type {
  TenantInitializationInput,
  TenantInitializer,
} from '../../platform/tenant/tenant-initializer';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

/** پایه‌های ریال، طلا و نقره را پیش از seed نوع‌های سکه ایجاد می‌کند. */
@Injectable()
export class InitialAssetDimensionsService implements TenantInitializer {
  constructor(@Inject(AssetDimensionsService) private readonly dimensions: AssetDimensionsService) {}

  async initializeInTransaction(
    transaction: TenantTransaction,
    input: TenantInitializationInput,
  ): Promise<void> {
    await this.dimensions.ensureBaseDimensionsInTransaction(transaction, input.tenantId);
  }
}
