import { z } from 'zod';
import { positiveBigIntStringSchema, uuidSchema } from '../common/index.js';

export const coinMintTypeSchema = z.enum(['CENTRAL_BANK', 'PRIVATE_MINT', 'OTHER']);

const coinTypeVersionBaseSchema = z.object({
  id: uuidSchema,
  coinTypeId: uuidSchema,
  code: z.string().min(1),
  title: z.string().min(1),
  /** JSON weight is always an exact integer microgram string, never a number. */
  grossWeightUg: positiveBigIntStringSchema,
  karat: z.number().int().min(1).max(1000),
  validFrom: z.string().datetime({ offset: true }),
  validTo: z.string().datetime({ offset: true }).nullable(),
  version: z.number().int().positive(),
  active: z.boolean(),
});

export const centralBankCoinTypeVersionSchema = coinTypeVersionBaseSchema.extend({
  mintType: z.literal('CENTRAL_BANK'),
  isCentralBankMinted: z.literal(true),
});

export const nonCentralBankCoinTypeVersionSchema = coinTypeVersionBaseSchema.extend({
  mintType: z.enum(['PRIVATE_MINT', 'OTHER']),
  isCentralBankMinted: z.literal(false),
});

/**
 * Coin quantities are not present here because they belong to ledger entries as
 * independent integer dimensions. This schema is reference data only.
 */
export const coinTypeVersionSchema = z.discriminatedUnion('isCentralBankMinted', [
  centralBankCoinTypeVersionSchema,
  nonCentralBankCoinTypeVersionSchema,
]);

export type CoinMintType = z.infer<typeof coinMintTypeSchema>;
export type CoinTypeVersion = z.infer<typeof coinTypeVersionSchema>;
