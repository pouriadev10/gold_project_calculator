import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router';
import { uuidSchema } from '@gold/contracts';
import { AppNav } from '@/components/common/AppNav';
import { FullPageLoading } from '@/components/common/FullPageLoading';
import { NotFoundPage } from '@/components/common/NotFoundPage';
import { requireAuth, requireRole } from '@/app/route-guards';
import { ForbiddenPage } from '@/features/auth/ForbiddenPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { HomePage } from '@/features/home/HomePage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useSessionGuard } from '@/hooks/useSessionGuard';
import { useTheme } from '@/hooks/useTheme';
import { useUnit } from '@/hooks/useUnit';
import { OPENING_BALANCE_ROLES, PROFIT_REPORT_ROLES } from '@/lib/permissions';

/**
 * ریشه‌ی بدون پوسته — فقط `<Outlet />`. مسیرهایی که نباید ناوبری برنامه
 * را ببینند (مثل ورود، پیش از احراز هویت) مستقیماً زیر همین می‌آیند؛
 * بقیه زیر `appShellRoute` (پوسته‌ی ناوبری + main) تو در تو می‌شوند.
 */
const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: NotFoundPage,
});

function AppShell() {
  // پوسته یک بار در ریشه اعمال و با تنظیم سیستم همگام می‌شود
  useTheme();
  // واحد نمایش (طلا/ریال) را بین تب‌های باز همگام نگه می‌دارد — FE-023
  useUnit();
  // مرگ نشست (تمدید ناموفق، خروج، خروج در تب دیگر) را می‌بیند و به ورود می‌فرستد — FE-027
  useSessionGuard();

  return (
    <div className="lg:flex lg:h-dvh lg:items-stretch lg:overflow-hidden">
      <AppNav />
      {/*
        فاصله‌ی پایین به‌اندازه‌ی نوار ناوبری تا محتوا زیرش پنهان نشود.
        از ۱۰۲۴px به بالا `main` خودش مستقل اسکرول می‌شود (نه کل صفحه)،
        وگرنه سایدبار هم با محتوا بالا می‌رفت و از دید خارج می‌شد — سایدبار
        باید هر لحظه در دسترس بماند. حداکثر عرض فقط جلوی کشیده‌شدن بی‌حدوحصر
        محتوا روی مانیتورهای خیلی عریض را می‌گیرد؛ زیر ۱۹۲۰px اصلاً اثر ندارد.
      */}
      <main className="min-w-0 flex-1 pb-nav lg:mx-auto lg:h-dvh lg:max-w-[1920px] lg:overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

const appShellRoute = createRoute({
  id: 'app-shell',
  getParentRoute: () => rootRoute,
  // محافظ احراز هویت — FE-028. یک‌جا روی ریشه‌ی همه‌ی مسیرهای پوسته‌دار، نه تک‌تک هر مسیر.
  beforeLoad: requireAuth,
  component: AppShell,
});

// ---- مسیر بدون پوسته ----

/**
 * دلیل رسیدن به صفحه‌ی ورود — رشته، نه boolean، چون رفت‌وبرگشت رشته در
 * query string بدون ابهام است. FE-027 وقتی تمدید نشست شکست بخورد، کاربر
 * را به همین مسیر با `reason=expired` هدایت می‌کند.
 */
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { reason?: 'expired' } =>
    search['reason'] === 'expired' ? { reason: 'expired' } : {},
  component: LoginPage,
});

// ---- مسیرهای زیر پوسته‌ی برنامه ----

const indexRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/dashboard' });
  },
});

const dashboardRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/dashboard',
  component: HomePage,
});

const pricingRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/pricing',
  // بدون beforeLoad نقش‌محور — خواندن مظنه برای هر نقشی باز است؛ فقط فرم
  // ثبت دستی داخل خودِ صفحه پنهان می‌شود (`PricingPage.tsx`, FE-030).
  component: lazyRouteComponent(() => import('@/features/pricing/PricingPage')),
});

const partiesRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/parties',
  // بدون beforeLoad نقش‌محور — GET /parties روی سرور بدون @Roles است (parties.controller.ts، BE-024)
  component: lazyRouteComponent(() => import('@/features/parties/PartiesPage')),
});

const partyDetailRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/parties/$partyId',
  params: {
    parse: (raw: { partyId: string }) => ({ partyId: uuidSchema.parse(raw.partyId) }),
    stringify: (parsed: { partyId: string }) => ({ partyId: parsed.partyId }),
  },
  component: lazyRouteComponent(() => import('@/features/parties/PartyDetailPage')),
});

/**
 * جانگه‌دار «ثبت تسویه» شخص — مسیر واقعی طبق `FrontTasks.md` (FE-055)
 * دقیقاً همین است: `/parties/:partyId/settlements/new`، نه مسیر تخت
 * `/settlements/new` که پایین‌تر برای زمانی که هنوز شخص مشخص نبود مانده.
 * بخش «ثبت تسویه»ی صفحه‌ی جزئیات شخص (FE-034) به همین‌جا لینک می‌دهد؛
 * صفحه‌ی واقعی با فرم settlement lines کار خودِ FE-055 است.
 */
const partySettlementsNewRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/parties/$partyId/settlements/new',
  params: {
    parse: (raw: { partyId: string }) => ({ partyId: uuidSchema.parse(raw.partyId) }),
    stringify: (parsed: { partyId: string }) => ({ partyId: parsed.partyId }),
  },
  component: lazyRouteComponent(() => import('@/app/route-placeholders'), 'SettlementsNewPlaceholder'),
});

const inventoryRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/inventory',
  component: lazyRouteComponent(() => import('@/app/route-placeholders'), 'InventoryPlaceholder'),
});

const inventoryJewelryRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/inventory/jewelry',
  // بدون beforeLoad نقش‌محور — GET /inventory/jewelry-items روی سرور بدون @Roles است (jewelry-items.controller.ts، BE-026)
  component: lazyRouteComponent(() => import('@/features/inventory/JewelryItemsPage')),
});

const inventoryCoinsRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/inventory/coins',
  // بدون beforeLoad نقش‌محور — همان استدلال inventoryJewelryRoute، خواندن موجودی محدود به نقش نیست
  component: lazyRouteComponent(() => import('@/features/inventory/CoinInventoryPage')),
});

const inventoryOpeningBalanceRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/inventory/opening-balance',
  // نقش‌محور — FE-039. @Roles('OWNER', 'MANAGER') روی POST /inventory/opening-balances هم هست
  // (opening-balances.controller.ts، BE-028)؛ اینجا فقط همان تصمیم را زودتر تکرار می‌کند.
  beforeLoad: requireRole(OPENING_BALANCE_ROLES),
  component: lazyRouteComponent(() => import('@/features/inventory/OpeningBalanceFormPage')),
});

const salesNewRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/sales/new',
  component: lazyRouteComponent(() => import('@/app/route-placeholders'), 'SalesNewPlaceholder'),
});

const salesInvoicesRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/sales/invoices',
  component: lazyRouteComponent(() => import('@/app/route-placeholders'), 'SalesInvoicesPlaceholder'),
});

const salesInvoiceDetailRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/sales/invoices/$invoiceId',
  params: {
    parse: (raw: { invoiceId: string }) => ({ invoiceId: uuidSchema.parse(raw.invoiceId) }),
    stringify: (parsed: { invoiceId: string }) => ({ invoiceId: parsed.invoiceId }),
  },
  component: lazyRouteComponent(
    () => import('@/app/route-placeholders'),
    'SalesInvoiceDetailPlaceholder',
  ),
});

const purchaseSecondHandRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/purchase/second-hand',
  component: lazyRouteComponent(() => import('@/app/route-placeholders'), 'PurchaseSecondHandPlaceholder'),
});

const settlementsNewRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/settlements/new',
  component: lazyRouteComponent(() => import('@/app/route-placeholders'), 'SettlementsNewPlaceholder'),
});

const reportingDebtorsRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/reporting/debtors',
  component: lazyRouteComponent(() => import('@/app/route-placeholders'), 'ReportingDebtorsPlaceholder'),
});

const reportingCreditorsRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/reporting/creditors',
  component: lazyRouteComponent(() => import('@/app/route-placeholders'), 'ReportingCreditorsPlaceholder'),
});

const reportingProfitRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/reporting/profit',
  // نقش‌محور — FE-028. لینک مستقیم برای CASHIER به /forbidden می‌رود، نه یک ۴۰۴ گنگ.
  beforeLoad: requireRole(PROFIT_REPORT_ROLES),
  component: lazyRouteComponent(() => import('@/app/route-placeholders'), 'ReportingProfitPlaceholder'),
});

const settingsRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/settings',
  component: SettingsPage,
});

const forbiddenRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: '/forbidden',
  component: ForbiddenPage,
});

/**
 * مسیر دود فقط در توسعه.
 *
 * `import.meta.env.DEV` در بیلد production به `false` تبدیل می‌شود، پس
 * کل این شاخه — و به‌همراهش `import()` تنبل صفحه‌ی دود — از درخت وابستگی
 * حذف می‌شود. نتیجه: این مسیر در بیلد نهایی اصلاً وجود ندارد.
 */
const devRoutes = import.meta.env.DEV
  ? [
      createRoute({
        getParentRoute: () => appShellRoute,
        path: '/_dev/smoke',
        component: lazyRouteComponent(() => import('@/features/dev/SmokePage')),
      }),
      createRoute({
        getParentRoute: () => appShellRoute,
        path: '/_dev/keypad',
        component: lazyRouteComponent(() => import('@/features/dev/KeypadHarness')),
      }),
      createRoute({
        getParentRoute: () => appShellRoute,
        path: '/_dev/party-selector',
        component: lazyRouteComponent(() => import('@/features/dev/PartySelectorHarness')),
      }),
    ]
  : [];

const routeTree = rootRoute.addChildren([
  loginRoute,
  appShellRoute.addChildren([
    indexRoute,
    dashboardRoute,
    pricingRoute,
    partiesRoute,
    partyDetailRoute,
    partySettlementsNewRoute,
    inventoryRoute,
    inventoryJewelryRoute,
    inventoryCoinsRoute,
    inventoryOpeningBalanceRoute,
    salesNewRoute,
    salesInvoicesRoute,
    salesInvoiceDetailRoute,
    purchaseSecondHandRoute,
    settlementsNewRoute,
    reportingDebtorsRoute,
    reportingCreditorsRoute,
    reportingProfitRoute,
    settingsRoute,
    forbiddenRoute,
    ...devRoutes,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  // chunk تنبل هر مسیر ممکن است روی شبکه‌ی ضعیف کمی طول بکشد؛ بدون این
  // در آن فاصله صفحه سفید می‌ماند — قاعده‌ی «هیچ صفحه‌ای هنگام loading
  // سفید نماند».
  defaultPendingComponent: FullPageLoading,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
