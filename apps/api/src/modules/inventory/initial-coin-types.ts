import type { CoinMintType } from '../../platform/database/schema';

export interface InitialCoinType {
  readonly code: string;
  readonly title: string;
  readonly mintType: CoinMintType;
  readonly grossWeightUg: bigint;
  readonly karat: number;
  readonly isCentralBankMinted: boolean;
  readonly active: boolean;
}

/**
 * Phase-1 reference data. Weights are exact integer micrograms, not rounded
 * milligrams. These values describe a coin type; ledger positions remain coin
 * counts in their own dimensions.
 */
export const INITIAL_COIN_TYPES = [
  {
    code: 'BAHAR_AZADI_NEW',
    title: 'تمام بهار آزادی (طرح جدید)',
    mintType: 'CENTRAL_BANK',
    grossWeightUg: 8_133_000n,
    karat: 900,
    isCentralBankMinted: true,
    active: true,
  },
  {
    code: 'NIM_BAHAR_AZADI',
    title: 'نیم سکه بهار آزادی',
    mintType: 'CENTRAL_BANK',
    grossWeightUg: 4_066_500n,
    karat: 900,
    isCentralBankMinted: true,
    active: true,
  },
  {
    code: 'ROB_BAHAR_AZADI',
    title: 'ربع سکه بهار آزادی',
    mintType: 'CENTRAL_BANK',
    grossWeightUg: 2_033_200n,
    karat: 900,
    isCentralBankMinted: true,
    active: true,
  },
  {
    code: 'GERAMI',
    title: 'سکه گرمی',
    mintType: 'CENTRAL_BANK',
    grossWeightUg: 1_016_600n,
    karat: 900,
    isCentralBankMinted: true,
    active: true,
  },
] as const satisfies readonly InitialCoinType[];
