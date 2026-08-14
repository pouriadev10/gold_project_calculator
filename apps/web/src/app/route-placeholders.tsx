import { PlaceholderPage } from '@/components/common/PlaceholderPage';

/**
 * محتوای صفحات جانگه‌دار برای مسیرهای فاز ۱ که هنوز پیاده‌سازی نشده‌اند.
 * همه در یک فایل تا با `lazyRouteComponent` یک chunk مشترک بسازند و از
 * بسته‌ی اولیه جدا بمانند — به‌جای اینکه هر مسیر chunk جداگانه بسازد.
 */

export function PricingPlaceholder() {
  return <PlaceholderPage title="مظنه" note="نمایش و ثبت مظنه در گام‌های بعد می‌آید." />;
}

export function PartiesPlaceholder() {
  return <PlaceholderPage title="اشخاص" note="حساب اشخاص و مانده‌ها در گام‌های بعد می‌آید." />;
}

export function PartyDetailPlaceholder() {
  return <PlaceholderPage title="جزئیات شخص" note="مشخصات، مانده و صورت‌حساب در گام‌های بعد می‌آید." />;
}

export function InventoryPlaceholder() {
  return <PlaceholderPage title="موجودی" note="داشبورد موجودی در گام‌های بعد می‌آید." />;
}

export function InventoryJewelryPlaceholder() {
  return <PlaceholderPage title="موجودی زیورآلات" note="فهرست مصنوعات در گام‌های بعد می‌آید." />;
}

export function InventoryCoinsPlaceholder() {
  return <PlaceholderPage title="موجودی سکه" note="فهرست موجودی سکه در گام‌های بعد می‌آید." />;
}

export function SalesNewPlaceholder() {
  return <PlaceholderPage title="فروش جدید" note="ثبت فاکتور فروش زیورآلات و سکه در گام‌های بعد می‌آید." />;
}

export function SalesInvoicesPlaceholder() {
  return <PlaceholderPage title="فاکتورهای فروش" note="فهرست فاکتورهای فروش در گام‌های بعد می‌آید." />;
}

export function SalesInvoiceDetailPlaceholder() {
  return <PlaceholderPage title="جزئیات فاکتور" note="جزئیات و اصلاح فاکتور در گام‌های بعد می‌آید." />;
}

export function PurchaseSecondHandPlaceholder() {
  return (
    <PlaceholderPage title="خرید دست‌دوم" note="خرید طلای دست‌دوم از مصرف‌کننده در گام‌های بعد می‌آید." />
  );
}

export function SettlementsNewPlaceholder() {
  return <PlaceholderPage title="ثبت تسویه" note="تسویه‌ی ترکیبی ریال/طلا/سکه در گام‌های بعد می‌آید." />;
}

export function ReportingDebtorsPlaceholder() {
  return <PlaceholderPage title="بدهکاران" note="فهرست بدهکاران در گام‌های بعد می‌آید." />;
}

export function ReportingCreditorsPlaceholder() {
  return <PlaceholderPage title="بستانکاران" note="فهرست بستانکاران در گام‌های بعد می‌آید." />;
}

export function ReportingProfitPlaceholder() {
  return <PlaceholderPage title="گزارش سود" note="گزارش سود دو مقیاسه در گام‌های بعد می‌آید." />;
}
