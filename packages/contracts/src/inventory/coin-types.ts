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

/* ── تنظیمات انواع سکه — FE-081 ───────────────────────────────── */

const MAX_COIN_CODE_LENGTH = 64;
const MAX_COIN_TITLE_LENGTH = 200;

/**
 * مشخصات یک نسخه‌ی نوع سکه، همان‌طور که کاربر می‌فرستد.
 *
 * `isCentralBankMinted` عمداً در ورودی نیست: سرور آن را از `mintType`
 * مشتق می‌کند (`mintType === 'CENTRAL_BANK'`) تا هیچ درخواستی نتواند برای
 * سکه‌ی غیر بانک مرکزی حباب ادعا کند (قاعده‌ی ۲-۳). `validFrom` هم در
 * ورودی نیست: نسخه‌ی تازه از «اکنون» معتبر است، چون همگام‌سازی عنوان و
 * فعال‌بودن بُعد دفتر کل فوری است و نسخه‌ی آینده‌دار آن را جلو می‌انداخت.
 */
const coinTypeSpecificationInputShape = {
  title: z.string().trim().min(1, 'عنوان الزامی است').max(MAX_COIN_TITLE_LENGTH),
  mintType: coinMintTypeSchema,
  /** وزن ناخالص مرجع، میکروگرم صحیح — رشته، هرگز `number`. */
  grossWeightUg: positiveBigIntStringSchema,
  karat: z.number().int().min(1, 'عیار باید بین ۱ و ۱۰۰۰ باشد').max(1000, 'عیار باید بین ۱ و ۱۰۰۰ باشد'),
  active: z.boolean(),
};

/** ورودی `POST /inventory/coin-types` — نوع تازه با نسخه‌ی ۱. کد بعداً تغییر نمی‌کند. */
export const createCoinTypeSchema = z
  .object({
    code: z.string().trim().min(1, 'کد الزامی است').max(MAX_COIN_CODE_LENGTH),
    ...coinTypeSpecificationInputShape,
  })
  .strict();

/** ورودی `POST /inventory/coin-types/:coinTypeId/versions` — نسخه‌ی بعدی، نسخه‌ی قبلی بسته می‌شود. */
export const createCoinTypeVersionSchema = z.object(coinTypeSpecificationInputShape).strict();

/** تاریخچه‌ی کامل یک نوع سکه، تازه‌ترین نسخه اول. */
export const coinTypeHistorySchema = z.object({
  coinTypeId: uuidSchema,
  code: z.string().min(1),
  versions: z.array(coinTypeVersionSchema).min(1),
});

/** پاسخ `GET /inventory/coin-types/history` — همه‌ی انواع، فعال و غیرفعال. */
export const coinTypeCatalogSchema = z.object({
  types: z.array(coinTypeHistorySchema),
});

export type CreateCoinTypeInput = z.infer<typeof createCoinTypeSchema>;
export type CreateCoinTypeVersionInput = z.infer<typeof createCoinTypeVersionSchema>;
export type CoinTypeHistory = z.infer<typeof coinTypeHistorySchema>;
export type CoinTypeCatalog = z.infer<typeof coinTypeCatalogSchema>;
