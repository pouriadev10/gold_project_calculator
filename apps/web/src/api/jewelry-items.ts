import { apiPatch, apiPost } from './client';
import {
  jewelryItemVersionSchema,
  type CreateJewelryItemInput,
  type JewelryItemVersion,
  type UpdateJewelryItemInput,
} from './contracts';

/**
 * ثبت کالای زیورآلات جدید — `POST /inventory/jewelry-items` (BE-026، FE-036).
 * همان الگوی `api/parties.ts`: نوشتنی که فرم مستقیم با `useIdempotentSubmit`
 * می‌پوشاند، نه `useMutation`.
 */
export function createJewelryItem(
  input: CreateJewelryItemInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<JewelryItemVersion> {
  return apiPost('/inventory/jewelry-items', input, jewelryItemVersionSchema, idempotencyKey, signal);
}

/**
 * ویرایش کالای زیورآلات — `PATCH /inventory/jewelry-items/:id` (BE-026، FE-036).
 * سرور خودش تصمیم می‌گیرد این ویرایش نسخه‌ی تازه می‌سازد (تغییر
 * مشخصات مالی) یا همان نسخه‌ی باز را جا‌به‌جا می‌کند (فقط تغییر عنوان)؛
 * فراخوان همیشه یک PATCH ساده می‌زند، فرقی نمی‌کند.
 */
export function updateJewelryItem(
  id: string,
  input: UpdateJewelryItemInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<JewelryItemVersion> {
  return apiPatch(`/inventory/jewelry-items/${id}`, input, jewelryItemVersionSchema, idempotencyKey, signal);
}
