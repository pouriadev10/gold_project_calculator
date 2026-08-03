import { z } from 'zod';

/** شناسه‌ی همه‌ی موجودیت‌ها. */
export const uuidSchema = z.string().uuid('شناسه باید UUID معتبر باشد');

export type Uuid = z.infer<typeof uuidSchema>;
