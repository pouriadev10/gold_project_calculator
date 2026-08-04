import { Inject, Injectable } from '@nestjs/common';
import { INITIAL_COIN_TYPES } from './initial-coin-types';
import { CoinTypesService } from './coin-types.service';
import type {
  TenantInitializationInput,
  TenantInitializer,
} from '../../platform/tenant/tenant-initializer';
import type { TenantTransaction } from '../../platform/database/tenant-transaction';

/** Seeds the tenant's initial independent coin dimensions and their first specifications. */
@Injectable()
export class InitialCoinTypesService implements TenantInitializer {
  constructor(@Inject(CoinTypesService) private readonly coinTypes: CoinTypesService) {}

  async initializeInTransaction(
    transaction: TenantTransaction,
    input: TenantInitializationInput,
  ): Promise<void> {
    for (const coinType of INITIAL_COIN_TYPES) {
      await this.coinTypes.createTypeInTransaction(transaction, {
        tenantId: input.tenantId,
        code: coinType.code,
        title: coinType.title,
        mintType: coinType.mintType,
        grossWeightUg: coinType.grossWeightUg,
        karat: coinType.karat,
        isCentralBankMinted: coinType.isCentralBankMinted,
        validFrom: input.validFrom,
        active: coinType.active,
      });
    }
  }
}
