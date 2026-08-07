import { z } from 'zod';
import { isoDateTimeSchema, positiveBigIntStringSchema, uuidSchema } from '../common/index.js';
import { inventoryBalanceSchema } from './inventory-movements.js';

const descriptionSchema = z.string().trim().min(1).max(2_000);

/**
 * Every opening line is positive. Corrections use a later, explicit source;
 * an opening balance is never silently rewritten as a negative movement.
 */
export const openingBalanceLineSchema = z.discriminatedUnion('itemType', [
  z
    .object({
      itemType: z.literal('JEWELRY'),
      itemId: uuidSchema,
      quantity: positiveBigIntStringSchema,
    })
    .strict(),
  z
    .object({
      itemType: z.literal('MELTED_GOLD'),
      quantity: positiveBigIntStringSchema,
    })
    .strict(),
  z
    .object({
      itemType: z.literal('COIN'),
      itemId: uuidSchema,
      /** Independent count-only coin dimension; never a gold-weight value. */
      quantity: positiveBigIntStringSchema,
    })
    .strict(),
]);

/** Input for `POST /inventory/opening-balances`. */
export const createOpeningBalanceSchema = z
  .object({
    effectiveAt: isoDateTimeSchema,
    description: descriptionSchema,
    lines: z.array(openingBalanceLineSchema).min(1).max(500),
  })
  .strict();

export const openingBalanceSchema = z.object({
  id: uuidSchema,
  ledgerTransactionId: uuidSchema,
  effectiveAt: isoDateTimeSchema,
  description: z.string(),
  createdAt: isoDateTimeSchema,
});

export const inventoryBalancesSchema = z.array(inventoryBalanceSchema);

export type OpeningBalanceLine = z.infer<typeof openingBalanceLineSchema>;
export type CreateOpeningBalanceInput = z.infer<typeof createOpeningBalanceSchema>;
export type OpeningBalance = z.infer<typeof openingBalanceSchema>;
export type InventoryBalances = z.infer<typeof inventoryBalancesSchema>;
