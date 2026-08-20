import type {
  InventoryItemType,
  JewelryItemQuery,
  PartyBalancesQuery,
  PartyListQuery,
  PartyStatementQuery,
  PriceQuoteType,
  ProfitPeriod,
} from './contracts';

/**
 * کارخانه‌ی کلید Query — تنها منبع ساخت `queryKey` در کل فرانت.
 *
 * چرا مهم است: هر Feature که کلید را خودش دستی بنویسد (`['parties', ...]`
 * در یک فایل، `['party', ...]` در فایلی دیگر) زودیر دیر invalidation را
 * می‌شکند — یک mutation کلید را با یک املای می‌زند و query دیگری با املای
 * دیگر می‌ماند، بی‌آنکه هیچ خطایی دیده شود.
 *
 * هر بخش دو نوع کلید دارد:
 * - `all()` — پیشوند کل خانواده. برای invalidation درشت («هر چیزی که به
 *   اشخاص مربوط است تازه شود») از همین استفاده کن، نه از تک‌تک کلیدها.
 * - بقیه — کلید دقیق یک query خاص، همیشه با گسترش `all()` ساخته می‌شود
 *   تا رابطه‌ی پیشوندی با TanStack Query (که با تطبیق پیشوندی invalidate
 *   می‌کند) دقیقاً برقرار بماند.
 *
 * فقط بخش‌هایی که همین حالا hook واقعی دارند اینجا هستند — برای فروش،
 * خرید و بقیه هروقت hookشان ساخته شد، همین‌جا اضافه می‌شود.
 */
export const queryKeys = {
  pricing: {
    all: () => ['pricing'] as const,
    latestQuote: (quoteType: PriceQuoteType) =>
      [...queryKeys.pricing.all(), 'latest', quoteType] as const,
    history: (quoteType: PriceQuoteType) =>
      [...queryKeys.pricing.all(), 'history', quoteType] as const,
  },

  parties: {
    all: () => ['parties'] as const,
    balanceSummary: () => [...queryKeys.parties.all(), 'balance-summary'] as const,
    search: (search: string) => [...queryKeys.parties.all(), 'search', search] as const,
    list: (query: PartyListQuery) => [...queryKeys.parties.all(), 'list', query] as const,
    detail: (id: string) => [...queryKeys.parties.all(), 'detail', id] as const,
    balances: (id: string, query: PartyBalancesQuery) =>
      [...queryKeys.parties.all(), 'balances', id, query] as const,
    statement: (id: string, query: PartyStatementQuery) =>
      [...queryKeys.parties.all(), 'statement', id, query] as const,
  },

  items: {
    all: () => ['items'] as const,
    search: (query: string, kind: string) =>
      [...queryKeys.items.all(), 'search', query, kind] as const,
  },

  /** کالای زیورآلات — `jewelryItemVersionSchema` واقعی (BE-026)، جدا از `items` بالا که هنوز mock تجمیعی است. */
  jewelryItems: {
    all: () => ['jewelry-items'] as const,
    list: (query: JewelryItemQuery) => [...queryKeys.jewelryItems.all(), 'list', query] as const,
  },

  /** کاتالوگ نوع سکه — `coinTypeVersionSchema` (BE-020)، بدون endpoint واقعی هنوز (FE-038). */
  coinTypes: {
    all: () => ['coin-types'] as const,
  },

  /** مانده‌ی موجودی — `GET /inventory/balances` واقعی (BE-028). */
  inventoryBalances: {
    all: () => ['inventory-balances'] as const,
    byItemType: (itemType: InventoryItemType) =>
      [...queryKeys.inventoryBalances.all(), itemType] as const,
  },

  transactions: {
    all: () => ['transactions'] as const,
    recent: (limit: number) => [...queryKeys.transactions.all(), 'recent', limit] as const,
  },

  reports: {
    all: () => ['reports'] as const,
    profit: (period: ProfitPeriod) => [...queryKeys.reports.all(), 'profit', period] as const,
  },
} as const;
