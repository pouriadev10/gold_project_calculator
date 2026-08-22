import { apiPost } from './client';
import {
  jewelryCashSaleSchema,
  jewelryCreditSaleSchema,
  type CreateJewelryCashSaleInput,
  type CreateJewelryCreditSaleInput,
  type JewelryCashSale,
  type JewelryCreditSale,
} from './contracts';

/**
 * ثبت فروش نقدی زیورآلات — `POST /sales/invoices/jewelry` (BE-041، FE-045).
 *
 * همان الگوی `api/pricing.ts` و `api/jewelry-items.ts`: یک نوشتن
 * یک‌بارمصرف که صفحه مستقیم با `useIdempotentSubmit` می‌پوشاند، نه با
 * `useMutation` — چون کلید Idempotency باید در طول تلاش‌های مجدد **همان**
 * بماند، و این چیزی است که `useIdempotentSubmit` تضمینش می‌کند، نه
 * `useMutation`.
 *
 * `idempotencyKey` اینجا عمداً آرگومان اجباری است، برخلاف خودِ `apiPost`
 * که پیش‌فرض تولید می‌کند: کلید تصادفیِ هر بار تازه روی **این** endpoint
 * یعنی هر ضربه‌ی دوم یک فاکتور دوم — دقیقاً همان چیزی که «ارسال تکراری
 * یک فاکتور نسازد» (BE-041) منع می‌کند. فراخوان باید صریح تصمیم بگیرد.
 */
export function createJewelryCashSale(
  input: CreateJewelryCashSaleInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<JewelryCashSale> {
  return apiPost('/sales/invoices/jewelry', input, jewelryCashSaleSchema, idempotencyKey, signal);
}

/**
 * ثبت فروش نسیه‌ی زیورآلات — `POST /sales/invoices/jewelry/credit`
 * (BE-042، FE-047).
 *
 * endpoint جداست، نه یک پرچم روی همان مسیر نقدی — چون سمت سرور هم
 * سرویس و سند حسابداری جداگانه‌ای دارد (`JewelryCreditSalesService`:
 * بخش پرداخت‌نشده به حساب دریافتنی همان شخص می‌نشیند، نه به صندوق).
 * `idempotencyKey` به همان دلیل نقدی اجباری است.
 */
export function createJewelryCreditSale(
  input: CreateJewelryCreditSaleInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<JewelryCreditSale> {
  return apiPost('/sales/invoices/jewelry/credit', input, jewelryCreditSaleSchema, idempotencyKey, signal);
}
