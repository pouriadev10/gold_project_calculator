import { z } from 'zod';
import {
  amendedSalesInvoiceSchema,
  b2cBuybackPreviewSchema,
  b2cBuybackSchema,
  coinSaleSchema,
  coinSettlementSchema,
  coinTypeCatalogSchema,
  coinTypeVersionSchema,
  dashboardSchema,
  generalSettingSchema,
  generalSettingsSchema,
  goldSettlementSchema,
  inventoryBalancesSchema,
  invoiceAmendmentPreflightSchema,
  jewelryCashSaleSchema,
  jewelryCreditSaleSchema,
  jewelryItemListSchema,
  jewelryItemVersionSchema,
  mixedSettlementSchema,
  openingBalanceSchema,
  partyBalanceReportSchema,
  partyBalancesSchema,
  partyListSchema,
  partySchema,
  partyStatementSchema,
  priceFeedRefreshResultSchema,
  priceFeedStatusSchema,
  priceQuoteSchema,
  profitReportSchema,
  recentInventoryMovementListSchema,
  recentTransactionListSchema,
  rialSettlementSchema,
  roleCodeSchema,
  salesInvoiceAmendmentHistorySchema,
  salesInvoiceDetailSchema,
  salesInvoiceListSchema,
  salesInvoiceVersionHistorySchema,
  secondHandCoinPurchaseSchema,
  secondHandGoldPurchaseSchema,
  sessionResponseSchema,
  sessionTenantSchema,
  sessionUserSchema,
  tenantExportDocumentSchema,
  tenantExportSchema,
} from '@gold/contracts';
import type { ZodTypeAny } from 'zod';

/** شکل بدنه‌ی پاسخ موفق. */
export type ResponseDoc =
  | { readonly kind: 'json'; readonly schema: ZodTypeAny; readonly wrap?: 'array' | 'nullable' }
  /** فایل JSON دانلودی (خروجی مستأجر) — با `X-File-Name` و `X-Content-SHA256`. */
  | { readonly kind: 'json-file'; readonly schema: ZodTypeAny }
  /** PDF سند — بدون `Content-Disposition`، نام فایل در `X-File-Name` (FE-098). */
  | { readonly kind: 'pdf' }
  | { readonly kind: 'empty' };

export interface RouteDoc {
  readonly tag: string;
  readonly summary: string;
  readonly description?: string;
  readonly response: ResponseDoc;
  /** نمونه‌ی دستی، وقتی نمونه‌ی خودکار از schema معتبر نمی‌شود (refine ِ چندفیلدی). */
  readonly requestExample?: unknown;
  readonly responseExample?: unknown;
}

const json = (schema: ZodTypeAny, wrap?: 'array' | 'nullable'): ResponseDoc =>
  wrap === undefined ? { kind: 'json', schema } : { kind: 'json', schema, wrap };
const PDF: ResponseDoc = { kind: 'pdf' };

/** `GET /health` و `GET /auth/me` قرارداد مشترک ندارند؛ شکلشان همین‌جا ثابت است. */
const healthSchema = z.object({ status: z.literal('ok') });
const meSchema = z.object({ user: sessionUserSchema, tenant: sessionTenantSchema, role: roleCodeSchema });

/*
 * نمونه‌های دستی — فقط جایی که refine ِ چندفیلدی قرارداد (مثلاً «فاکتور نهایی شماره و snapshot دارد»)
 * با نمونه‌ی خودکار برآورده نمی‌شود. این‌ها هم با همان schema اعتبارسنجی می‌شوند.
 */
const INVOICE_ID = '9c1e4b2a-6d3f-4a8e-b7c5-0f1a2b3c4d5e';
const PARTY_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const USER_ID = '7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a';
const ITEM_ID = '4e5f6a7b-8c9d-4e0f-a1b2-c3d4e5f6a7b8';

const salesInvoiceListExample = {
  items: [
    {
      id: INVOICE_ID,
      invoiceNumber: 1,
      invoicePeriod: '1405',
      status: 'FINALIZED',
      currentVersion: 1,
      party: { id: PARTY_ID, displayName: 'علی رضایی' },
      payableRial: '214560000',
      goldRatePerGramRial: '30779000',
      occurredAt: '2026-03-21T07:00:00.000Z',
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
};

const salesInvoiceDetailExample = {
  id: INVOICE_ID,
  invoiceNumber: 1,
  invoicePeriod: '1405',
  status: 'FINALIZED',
  currentVersion: 1,
  party: { id: PARTY_ID, displayName: 'علی رضایی', type: 'CONSUMER', status: 'ACTIVE' },
  occurredAt: '2026-03-21T07:00:00.000Z',
  quoteSnapshot: {
    amountRial: '100000000',
    goldRatePerGramRial: '30779000',
    observedAt: '2026-03-21T06:55:00.000Z',
  },
  versions: [
    {
      version: 1,
      reason: null,
      reasonDetail: null,
      actor: { id: USER_ID, displayName: 'مالک فروشگاه' },
      createdAt: '2026-03-21T07:00:00.000Z',
      payableRial: '214560000',
      paidRial: '214560000',
      receivableRial: '0',
      pureWeightMg: '4575',
      items: [
        {
          itemType: 'JEWELRY',
          itemId: ITEM_ID,
          title: 'انگشتر ۱۸ عیار',
          quantity: '1',
          pureWeightMg: '4575',
          karat: 750,
          payableRial: '214560000',
        },
      ],
      settingsSnapshot: {
        baseQuoteKarat: '705',
        mithqalGramsX10k: '46083',
        roundingUnitRial: '1000',
        roundingPolicy: 'HALF_UP',
        profitRateBps: '700',
        taxRateBps: '1000',
      },
      ledgerSummary: { transactionCount: 1, entryCount: 6, balanced: true },
    },
  ],
};

const RATE_SNAPSHOT =
  'مظنه‌ی لحظه‌ی ثبت در سند قفل می‌شود (`quoteId` و مبلغش)؛ گزارش و چاپ بعدی هرگز با مظنه‌ی امروز بازمحاسبه نمی‌شود.';

/**
 * مستند هر مسیر فاز ۱ — BE-070.
 *
 * فقط آنچه از کد قابل استخراج نیست: خلاصه و قرارداد پاسخ. متد، مسیر، کد
 * وضعیت، نقش‌ها، احراز هویت و schema ِ ورودی از metadata ِ خود Nest خوانده
 * می‌شوند (`route-discovery.ts`). آزمون `openapi.spec.ts` تضمین می‌کند کلیدهای
 * این فهرست دقیقاً همان مسیرهای واقعی برنامه‌اند — نه یکی کم، نه یکی بیشتر.
 */
export const ROUTE_DOCS: Readonly<Record<string, RouteDoc>> = {
  'GET /health': { tag: 'سامانه', summary: 'سلامت سرویس (بدون احراز هویت و مستأجر)', response: json(healthSchema) },

  'POST /auth/login': {
    tag: 'احراز هویت',
    summary: 'ورود با ایمیل، رمز و slug مستأجر',
    description: 'توکن دسترسی کوتاه‌عمر و توکن تمدید برمی‌گرداند. مستأجر از `tenantSlug` می‌آید، نه از هدر.',
    response: json(sessionResponseSchema),
  },
  'POST /auth/refresh': {
    tag: 'احراز هویت',
    summary: 'تمدید نشست',
    description: 'توکن تمدید یک‌بارمصرف است: پاسخ هر دو توکن تازه را دارد و توکن قبلی باطل می‌شود.',
    response: json(sessionResponseSchema),
  },
  'POST /auth/logout': { tag: 'احراز هویت', summary: 'خروج و ابطال توکن تمدید', response: { kind: 'empty' } },
  'GET /auth/me': { tag: 'احراز هویت', summary: 'کاربر، مستأجر و نقش نشست جاری', response: json(meSchema) },

  'GET /settings/general': { tag: 'تنظیمات', summary: 'تنظیمات عمومی جاری مستأجر', response: json(generalSettingsSchema) },
  'POST /settings/general': {
    tag: 'تنظیمات',
    summary: 'نسخه‌ی تازه‌ی یک تنظیم',
    description: 'تنظیمات نسخه‌دارند؛ نسخه‌ی قبلی بسته می‌شود و سندهای گذشته با همان نسخه‌ی خودشان بازتولید می‌شوند.',
    response: json(generalSettingSchema),
    requestExample: { key: 'purchase.second_hand_default_karat', value: '740' },
  },

  'GET /pricing/quotes': { tag: 'مظنه', summary: 'تاریخچه‌ی مظنه', response: json(priceQuoteSchema, 'array') },
  'GET /pricing/quotes/latest': {
    tag: 'مظنه',
    summary: 'آخرین مظنه (یا null)',
    response: json(priceQuoteSchema, 'nullable'),
  },
  'POST /pricing/quotes/manual': { tag: 'مظنه', summary: 'ثبت دستی مظنه', response: json(priceQuoteSchema) },
  'GET /pricing/feed/status': { tag: 'مظنه', summary: 'وضعیت فید مظنه', response: json(priceFeedStatusSchema) },
  'POST /pricing/feed/refresh': { tag: 'مظنه', summary: 'دریافت دستی مظنه از فید', response: json(priceFeedRefreshResultSchema) },

  'GET /parties': { tag: 'اشخاص', summary: 'فهرست صفحه‌بندی‌شده‌ی طرف حساب‌ها', response: json(partyListSchema) },
  'POST /parties': { tag: 'اشخاص', summary: 'ثبت طرف حساب', response: json(partySchema) },
  'GET /parties/:id': { tag: 'اشخاص', summary: 'جزئیات طرف حساب', response: json(partySchema) },
  'PATCH /parties/:id': { tag: 'اشخاص', summary: 'ویرایش طرف حساب', response: json(partySchema) },
  'POST /parties/:id/deactivate': { tag: 'اشخاص', summary: 'غیرفعال‌سازی طرف حساب', response: json(partySchema) },
  'GET /parties/:id/balances': {
    tag: 'اشخاص',
    summary: 'مانده‌ی چندواحدی طرف حساب',
    description: 'مانده در هر بُعد (ریال، طلا، هر نوع سکه) جدا، به‌علاوه‌ی معادل طلایی با مظنه‌ی مرجع (`referenceQuoteId` یا آخرین مظنه).',
    response: json(partyBalancesSchema),
  },
  'GET /parties/:id/statement': { tag: 'اشخاص', summary: 'صورت‌حساب طرف حساب', response: json(partyStatementSchema) },
  'GET /parties/:id/statement/pdf': { tag: 'اشخاص', summary: 'PDF صورت‌حساب', response: PDF },

  'POST /parties/:partyId/settlements/rial': { tag: 'تسویه', summary: 'تسویه‌ی ریالی', response: json(rialSettlementSchema) },
  'POST /parties/:partyId/settlements/gold': {
    tag: 'تسویه',
    summary: 'تسویه‌ی طلایی',
    description: RATE_SNAPSHOT,
    response: json(goldSettlementSchema),
  },
  'POST /parties/:partyId/settlements/coins': { tag: 'تسویه', summary: 'تسویه‌ی سکه‌ای (تعداد)', response: json(coinSettlementSchema) },
  'POST /parties/:partyId/settlements/mixed': {
    tag: 'تسویه',
    summary: 'تسویه‌ی ترکیبی چندواحدی',
    description: RATE_SNAPSHOT,
    response: json(mixedSettlementSchema),
  },

  'GET /inventory/balances': { tag: 'موجودی', summary: 'موجودی فعلی', response: json(inventoryBalancesSchema) },
  'POST /inventory/opening-balances': { tag: 'موجودی', summary: 'ثبت موجودی افتتاحیه', response: json(openingBalanceSchema) },
  'GET /inventory/movements/recent': { tag: 'موجودی', summary: 'آخرین حرکت‌های موجودی', response: json(recentInventoryMovementListSchema) },
  'GET /inventory/coin-types': { tag: 'موجودی', summary: 'انواع سکه با مشخصات جاری', response: json(coinTypeVersionSchema, 'array') },
  'GET /inventory/coin-types/history': { tag: 'موجودی', summary: 'انواع سکه با همه‌ی نسخه‌ها', response: json(coinTypeCatalogSchema) },
  'POST /inventory/coin-types': { tag: 'موجودی', summary: 'تعریف نوع سکه', response: json(coinTypeVersionSchema) },
  'POST /inventory/coin-types/:coinTypeId/versions': {
    tag: 'موجودی',
    summary: 'نسخه‌ی تازه‌ی مشخصات سکه',
    description: 'وزن و عیار سکه نسخه‌دار است؛ فقط سکه‌ی ضرب بانک مرکزی حباب دارد.',
    response: json(coinTypeVersionSchema),
  },
  'GET /inventory/jewelry-items': { tag: 'موجودی', summary: 'فهرست کالاها', response: json(jewelryItemListSchema) },
  'POST /inventory/jewelry-items': { tag: 'موجودی', summary: 'تعریف کالا', response: json(jewelryItemVersionSchema) },
  'GET /inventory/jewelry-items/:id': { tag: 'موجودی', summary: 'جزئیات کالا', response: json(jewelryItemVersionSchema) },
  'PATCH /inventory/jewelry-items/:id': { tag: 'موجودی', summary: 'نسخه‌ی تازه‌ی مشخصات کالا', response: json(jewelryItemVersionSchema) },
  'POST /inventory/jewelry-items/:id/deactivate': { tag: 'موجودی', summary: 'غیرفعال‌سازی کالا', response: json(jewelryItemVersionSchema) },

  'GET /sales/invoices': {
    tag: 'فروش',
    summary: 'فهرست فاکتورها',
    response: json(salesInvoiceListSchema),
    responseExample: salesInvoiceListExample,
  },
  'GET /sales/invoices/:invoiceId/detail': {
    tag: 'فروش',
    summary: 'جزئیات فاکتور',
    description: RATE_SNAPSHOT,
    response: json(salesInvoiceDetailSchema),
    responseExample: salesInvoiceDetailExample,
  },
  'GET /sales/invoices/:invoiceId/versions': { tag: 'فروش', summary: 'نسخه‌های فاکتور', response: json(salesInvoiceVersionHistorySchema) },
  'GET /sales/invoices/:invoiceId/amendments': { tag: 'فروش', summary: 'تاریخچه‌ی اصلاح فاکتور', response: json(salesInvoiceAmendmentHistorySchema) },
  'GET /sales/invoices/:invoiceId/pdf': { tag: 'فروش', summary: 'PDF فاکتور', response: PDF },
  'POST /sales/invoices/jewelry': {
    tag: 'فروش',
    summary: 'فروش نقدی زیورآلات',
    description: RATE_SNAPSHOT,
    response: json(jewelryCashSaleSchema),
  },
  'POST /sales/invoices/jewelry/credit': {
    tag: 'فروش',
    summary: 'فروش نسیه‌ی زیورآلات',
    description: RATE_SNAPSHOT,
    response: json(jewelryCreditSaleSchema),
  },
  'POST /sales/invoices/coins': {
    tag: 'فروش',
    summary: 'فروش سکه',
    description: 'قیمت بازار هر سکه را کاربر می‌دهد؛ ارزش ذاتی و حباب فقط برای گزارش محاسبه و در سند ذخیره می‌شوند.',
    response: json(coinSaleSchema),
  },
  'GET /sales/invoices/:invoiceId/amendment-policy': {
    tag: 'فروش',
    summary: 'آیا فاکتور هنوز در پنجره‌ی اصلاح است',
    response: json(invoiceAmendmentPreflightSchema),
  },
  'POST /sales/invoices/:invoiceId/amend': {
    tag: 'فروش',
    summary: 'اصلاح فاکتور (نسخه‌ی تازه + سند تفاضلی)',
    description: 'دفتر کل append-only است: اصلاح سند جدید است، نه ویرایش سند قدیم.',
    response: json(amendedSalesInvoiceSchema),
  },

  'POST /sales/invoices/:invoiceId/b2c-buyback/preview': {
    tag: 'خرید',
    summary: 'پیش‌نمایش مرجوعی مصرف‌کننده (خرید دست‌دوم)',
    description:
      'مرجوعی B2C از نظر حسابداری خرید طلای دست‌دوم است: عیار خرید تنظیم مستأجر، مظنه‌ی روز مرجوعی، اجرت سوخت. هیچ چیز ثبت نمی‌شود.',
    response: json(b2cBuybackPreviewSchema),
  },
  'POST /sales/invoices/:invoiceId/b2c-buyback': {
    tag: 'خرید',
    summary: 'ثبت مرجوعی مصرف‌کننده (خرید دست‌دوم)',
    description: RATE_SNAPSHOT,
    response: json(b2cBuybackSchema),
  },
  'POST /purchase/second-hand/gold': {
    tag: 'خرید',
    summary: 'خرید طلای دست‌دوم از مصرف‌کننده',
    description: RATE_SNAPSHOT,
    response: json(secondHandGoldPurchaseSchema),
  },
  'POST /purchase/second-hand/coins': { tag: 'خرید', summary: 'خرید سکه از مصرف‌کننده', response: json(secondHandCoinPurchaseSchema) },
  'GET /purchase/second-hand/:purchaseId/pdf': { tag: 'خرید', summary: 'PDF رسید خرید', response: PDF },

  'GET /reporting/dashboard': { tag: 'گزارش', summary: 'داشبورد', response: json(dashboardSchema) },
  'GET /reporting/profit': {
    tag: 'گزارش',
    summary: 'گزارش سود دومقیاسه (طلا و ریال)',
    response: json(profitReportSchema),
  },
  'GET /reporting/debtors': { tag: 'گزارش', summary: 'فهرست بدهکاران', response: json(partyBalanceReportSchema) },
  'GET /reporting/creditors': { tag: 'گزارش', summary: 'فهرست بستانکاران', response: json(partyBalanceReportSchema) },
  'GET /transactions/recent': { tag: 'گزارش', summary: 'آخرین معاملات', response: json(recentTransactionListSchema) },

  'POST /platform/exports/full': {
    tag: 'سکو',
    summary: 'ساخت خروجی کامل داده‌ی مستأجر',
    description: 'فقط OWNER. قالب فایل در `docs/tenant-export.md`.',
    response: json(tenantExportSchema),
  },
  'GET /platform/exports/:id': {
    tag: 'سکو',
    summary: 'دانلود خروجی کامل داده‌ی مستأجر',
    response: { kind: 'json-file', schema: tenantExportDocumentSchema },
  },
};
