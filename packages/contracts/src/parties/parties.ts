import { z } from 'zod';
import { paginatedSchema, paginationQuerySchema, uuidSchema } from '../common/index.js';

/** Classifications supported for phase-1 counterparties. */
export const partyTypeSchema = z.enum(['CONSUMER', 'BUSINESS']);

/** A party is retained for history and can only be made unavailable, not deleted. */
export const partyStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

const displayNameSchema = z.string().trim().min(1).max(200);
const mobileSchema = z.string().trim().min(1).max(32);
const nationalIdSchema = z.string().trim().min(1).max(32);
const notesSchema = z.string().trim().max(2_000);

/** Input for `POST /parties`. Server-side normalization owns derived search fields. */
export const createPartySchema = z
  .object({
    type: partyTypeSchema,
    displayName: displayNameSchema,
    mobile: mobileSchema.optional(),
    nationalId: nationalIdSchema.optional(),
    linkedTenantId: uuidSchema.optional(),
    notes: notesSchema.optional(),
  })
  .strict();

/** Input for `PATCH /parties/:id`; null clears an optional identifying field. */
export const updatePartySchema = z
  .object({
    type: partyTypeSchema.optional(),
    displayName: displayNameSchema.optional(),
    mobile: mobileSchema.nullable().optional(),
    nationalId: nationalIdSchema.nullable().optional(),
    linkedTenantId: uuidSchema.nullable().optional(),
    notes: notesSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'حداقل یک فیلد برای ویرایش لازم است');

/** Search, status/type filters, and offset pagination for `GET /parties`. */
export const partyListQuerySchema = paginationQuerySchema
  .extend({
    search: z.string().trim().min(1).max(200).optional(),
    type: partyTypeSchema.optional(),
    status: partyStatusSchema.optional(),
  })
  .strict();

/** JSON representation of a tenant-scoped counterparty. */
export const partySchema = z.object({
  id: uuidSchema,
  type: partyTypeSchema,
  displayName: z.string(),
  mobile: z.string().nullable(),
  nationalId: z.string().nullable(),
  linkedTenantId: uuidSchema.nullable(),
  status: partyStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const partyListSchema = paginatedSchema(partySchema);

export type CreatePartyInput = z.infer<typeof createPartySchema>;
export type UpdatePartyInput = z.infer<typeof updatePartySchema>;
export type PartyListQuery = z.infer<typeof partyListQuerySchema>;
export type Party = z.infer<typeof partySchema>;
export type PartyList = z.infer<typeof partyListSchema>;
