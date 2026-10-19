import { z } from 'zod';
import {
  isoDateTimeSchema,
  nonNegativeBigIntStringSchema,
  paginatedSchema,
  paginationQuerySchema,
  positiveBigIntStringSchema,
  uuidSchema,
} from '../common/index.js';
import { invoicePeriodSchema } from './invoice-period.js';

/**
 * فهرست و جزئیات فاکتور فروش — فقط‌خواندنی، FE-106b.
 *
 * پیش‌تر View model محلی فرانت بود (FE-064/FE-065) و فقط MSW پاسخش را
 * می‌داد؛ حالا `GET /sales/invoices` و `GET /sales/invoices/:invoiceId/detail`
 * همین شکل را از `sales_invoices`، نسخه‌ها، شخص و دفترکل می‌سازند.
 *
 * هر عدد مالی/وزنی از snapshot خود سند می‌آید و نرخ گرم ۱۰۰۰ همان نرخ قفل‌شده‌ی
 * لحظه‌ی فروش است (قاعده‌ی ۲-۸)؛ تعویض واحد هرگز از مظنه‌ی امروز استفاده نمی‌کند.
 */
export const salesInvoiceStatusSchema = z.enum(['DRAFT', 'FINALIZED']);

/** `to` **شامل** است (`<=`): فرانت آخرین میلی‌ثانیه‌ی روز آخر را می‌فرستد. */
export const salesInvoiceListQuerySchema = paginationQuerySchema
  .extend({
    /**
     * بخشی از شناسه‌ی فاکتور: «12»، «1405-12» یا «1405-» (D-02). سرور روی شکل کامل
     * `دوره-شماره` جست‌وجو می‌کند، پس شماره‌ی تنها همه‌ی سال‌ها را پیدا می‌کند.
     */
    invoiceNumber: z
      .string()
      .max(20)
      .regex(/^(?=.*\d)\d*-?\d*$/u, 'شماره‌ی فاکتور فقط رقم و یک خط تیره بین سال و شماره است')
      .optional(),
    partySearch: z.string().trim().min(1).max(200).optional(),
    status: salesInvoiceStatusSchema.optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.from !== undefined &&
      value.to !== undefined &&
      new Date(value.from).getTime() > new Date(value.to).getTime()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'پایان بازه نباید پیش از شروع آن باشد',
      });
    }
  });

export const salesInvoiceListItemSchema = z
  .object({
    id: uuidSchema,
    invoiceNumber: z.number().int().positive().nullable(),
    invoicePeriod: invoicePeriodSchema.nullable(),
    status: salesInvoiceStatusSchema,
    currentVersion: z.number().int().nonnegative(),
    party: z.object({
      id: uuidSchema,
      displayName: z.string().min(1),
    }),
    payableRial: nonNegativeBigIntStringSchema.nullable(),
    goldRatePerGramRial: nonNegativeBigIntStringSchema.nullable(),
    occurredAt: isoDateTimeSchema,
  })
  .superRefine((value, context) => {
    const draftShape =
      value.status === 'DRAFT' &&
      value.invoiceNumber === null &&
      value.invoicePeriod === null &&
      value.currentVersion === 0 &&
      value.payableRial === null &&
      value.goldRatePerGramRial === null;
    const finalizedShape =
      value.status === 'FINALIZED' &&
      value.invoiceNumber !== null &&
      value.invoicePeriod !== null &&
      value.currentVersion >= 1 &&
      value.payableRial !== null &&
      value.goldRatePerGramRial !== null &&
      BigInt(value.goldRatePerGramRial) > 0n;

    if (!draftShape && !finalizedShape) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'وضعیت فاکتور با شماره، نسخه و snapshot مالی آن سازگار نیست',
      });
    }
  });

export const salesInvoiceListSchema = paginatedSchema(salesInvoiceListItemSchema);

const salesInvoiceDetailItemSchema = z.object({
  itemType: z.enum(['JEWELRY', 'COIN']),
  itemId: uuidSchema,
  title: z.string().trim().min(1),
  quantity: positiveBigIntStringSchema,
  pureWeightMg: nonNegativeBigIntStringSchema.nullable(),
  karat: z.number().int().min(1).max(1000).nullable(),
  payableRial: nonNegativeBigIntStringSchema,
});

/** تنظیمات نسخه‌دار همان لحظه‌ی فروش. فروش سکه گرد کردن/سود/مالیات ندارد، پس `null`. */
const salesInvoiceSettingsSnapshotSchema = z.object({
  baseQuoteKarat: nonNegativeBigIntStringSchema.nullable(),
  mithqalGramsX10k: nonNegativeBigIntStringSchema.nullable(),
  roundingUnitRial: nonNegativeBigIntStringSchema.nullable(),
  roundingPolicy: z.string().trim().min(1).nullable(),
  profitRateBps: nonNegativeBigIntStringSchema.nullable(),
  taxRateBps: nonNegativeBigIntStringSchema.nullable(),
});

const salesInvoiceDetailVersionSchema = z.object({
  version: z.number().int().positive(),
  reason: z.string().nullable(),
  reasonDetail: z.string().nullable(),
  actor: z
    .object({
      id: uuidSchema,
      displayName: z.string().trim().min(1),
    })
    .nullable(),
  createdAt: isoDateTimeSchema,
  payableRial: nonNegativeBigIntStringSchema,
  paidRial: nonNegativeBigIntStringSchema,
  receivableRial: nonNegativeBigIntStringSchema,
  pureWeightMg: nonNegativeBigIntStringSchema.nullable(),
  items: z.array(salesInvoiceDetailItemSchema),
  settingsSnapshot: salesInvoiceSettingsSnapshotSchema,
  ledgerSummary: z.object({
    transactionCount: z.number().int().nonnegative(),
    entryCount: z.number().int().nonnegative(),
    balanced: z.boolean(),
  }),
});

export const salesInvoiceDetailSchema = z
  .object({
    id: uuidSchema,
    invoiceNumber: z.number().int().positive().nullable(),
    invoicePeriod: invoicePeriodSchema.nullable(),
    status: salesInvoiceStatusSchema,
    currentVersion: z.number().int().nonnegative(),
    party: z.object({
      id: uuidSchema,
      displayName: z.string().trim().min(1),
      type: z.enum(['CONSUMER', 'BUSINESS']),
      status: z.enum(['ACTIVE', 'INACTIVE']),
    }),
    occurredAt: isoDateTimeSchema,
    quoteSnapshot: z
      .object({
        amountRial: positiveBigIntStringSchema,
        goldRatePerGramRial: positiveBigIntStringSchema,
        observedAt: isoDateTimeSchema,
      })
      .nullable(),
    versions: z.array(salesInvoiceDetailVersionSchema),
  })
  .superRefine((value, context) => {
    const currentVersions = value.versions.filter(
      (version) => version.version === value.currentVersion,
    );
    const draftShape =
      value.status === 'DRAFT' &&
      value.invoiceNumber === null &&
      value.invoicePeriod === null &&
      value.currentVersion === 0 &&
      value.quoteSnapshot === null &&
      value.versions.length === 0;
    const finalizedShape =
      value.status === 'FINALIZED' &&
      value.invoiceNumber !== null &&
      value.invoicePeriod !== null &&
      value.currentVersion > 0 &&
      value.quoteSnapshot !== null &&
      currentVersions.length === 1;

    if (!draftShape && !finalizedShape) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'جزئیات فاکتور با وضعیت و نسخه جاری آن سازگار نیست',
      });
    }
  });

export type SalesInvoiceStatus = z.infer<typeof salesInvoiceStatusSchema>;
export type SalesInvoiceListQuery = z.infer<typeof salesInvoiceListQuerySchema>;
export type SalesInvoiceListItem = z.infer<typeof salesInvoiceListItemSchema>;
export type SalesInvoiceList = z.infer<typeof salesInvoiceListSchema>;
export type SalesInvoiceDetail = z.infer<typeof salesInvoiceDetailSchema>;
