import { describe, expect, it } from 'vitest';
import {
  coinTypeCatalogSchema,
  coinTypeVersionSchema,
  createCoinTypeSchema,
  createCoinTypeVersionSchema,
} from '../src/inventory/coin-types.js';

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

describe('coin type settings input — FE-081', () => {
  const spec = {
    title: 'ربع سکه بهار آزادی',
    mintType: 'CENTRAL_BANK',
    grossWeightUg: '2033200',
    karat: 900,
    active: true,
  } as const;

  it('accepts a new type with an immutable code and an exact microgram weight', () => {
    expect(createCoinTypeSchema.parse({ code: ' ROB ', ...spec })).toEqual({ code: 'ROB', ...spec });
  });

  it('never lets the client claim bubble eligibility or pick the start date', () => {
    expect(createCoinTypeVersionSchema.safeParse({ ...spec, isCentralBankMinted: true }).success).toBe(false);
    expect(
      createCoinTypeVersionSchema.safeParse({ ...spec, validFrom: '2026-10-01T00:00:00.000Z' }).success,
    ).toBe(false);
  });

  it.each([
    ['a JSON number weight', { grossWeightUg: 2033200 }],
    ['a zero weight', { grossWeightUg: '0' }],
    ['a fractional weight', { grossWeightUg: '2033.2' }],
    ['karat 0', { karat: 0 }],
    ['karat above 1000', { karat: 1001 }],
    ['an empty title', { title: '   ' }],
    ['an unknown mint', { mintType: 'BULLION' }],
  ])('rejects %s', (_label, patch) => {
    expect(createCoinTypeVersionSchema.safeParse({ ...spec, ...patch }).success).toBe(false);
  });

  it('describes the full history of each type, newest version first', () => {
    const catalog = coinTypeCatalogSchema.parse({
      types: [
        {
          coinTypeId: centralBankCoin.coinTypeId,
          code: centralBankCoin.code,
          versions: [centralBankCoin],
        },
      ],
    });
    expect(catalog.types[0]?.versions).toHaveLength(1);
    expect(
      coinTypeCatalogSchema.safeParse({
        types: [{ coinTypeId: centralBankCoin.coinTypeId, code: 'X', versions: [] }],
      }).success,
    ).toBe(false);
  });
});
