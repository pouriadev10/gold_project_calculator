import { describe, expect, it } from 'vitest';
import { coinTypeVersionSchema } from '../src/inventory/coin-types.js';

const centralBankCoin = {
  id: 'a4555172-3398-4a25-8fe6-b058650e5e9c',
  coinTypeId: '6d099aa7-8e05-460e-a0e4-57057a05138e',
  code: 'BAHAR_AZADI_NEW',
  title: 'تمام بهار آزادی (طرح جدید)',
  mintType: 'CENTRAL_BANK',
  isCentralBankMinted: true,
  grossWeightUg: '8133000',
  karat: 900,
  validFrom: '2026-08-04T00:00:00.000Z',
  validTo: null,
  version: 1,
  active: true,
} as const;

describe('coin type contract', () => {
  it('uses an exact microgram string for the coin reference weight', () => {
    expect(coinTypeVersionSchema.parse(centralBankCoin).grossWeightUg).toBe('8133000');
  });

  it('does not accept a JSON number for grossWeightUg', () => {
    expect(
      coinTypeVersionSchema.safeParse({ ...centralBankCoin, grossWeightUg: 8133000 }).success,
    ).toBe(false);
  });

  it('does not permit a non-central mint to advertise bubble eligibility', () => {
    expect(
      coinTypeVersionSchema.safeParse({
        ...centralBankCoin,
        mintType: 'PRIVATE_MINT',
        isCentralBankMinted: true,
      }).success,
    ).toBe(false);
  });
});
