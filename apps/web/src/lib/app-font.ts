/**
 * بار کردن وزیرمتن از JS، نه از `@font-face` در CSS — FE-088.
 *
 * فونت ۴۸KB است. با `@font-face` + `font-display: swap` دو هزینه روی 3G داشت:
 *
 * ۱. هم‌زمان با بسته‌ی JS، چانک مسیر و پاسخ API دانلود می‌شد و پهنای باند را از
 *    محتوای اصلی می‌گرفت؛
 * ۲. وقتی می‌رسید، متنِ از قبل نمایش‌داده‌شده با فونت تازه دوباره چیده می‌شد — Chrome
 *    همین بازچینی را رنگ‌آمیزی تازه‌ی LCP حساب می‌کند، پس LCP عملاً «رسیدن فونت» بود؛
 *    و کاربر هم پرش متنی را می‌دید که داشت می‌خواند.
 *
 * سیاست تازه (همان رفتار `font-display: optional`، ولی قطعی):
 *
 * - **بارهای بعد** (فونت یک بار با موفقیت بار شده، پس در کش HTTP و precache سرویس‌ورکر
 *   است): همان ابتدای بالا آمدن ثبت می‌شود و پیش از اولین رندر React حاضر است — بدون
 *   هیچ جابه‌جایی.
 * - **بار اول**: پس از نشستن داده‌ی صفحه‌ی اول دانلود می‌شود ولی روی همان صفحه اعمال
 *   **نمی‌شود**؛ از ناوبری بعدی (که محتوای صفحه به‌هرحال عوض می‌شود) اعمال می‌شود. تا
 *   آن لحظه متن با فونت سیستم است — همان چیزی که swap هم نشان می‌داد.
 *
 * نسخه‌ی **بدون لاتین** (۴۷KB به‌جای ۱۰۹KB): کل رابط فارسی است و ارقام هم فارسی
 * نمایش داده می‌شوند. هر نویسه‌ی لاتین پراکنده به فونت سیستم برمی‌گردد.
 */
export const APP_FONT_URL = '/fonts/vazirmatn-fa.woff2';
export const APP_FONT_FAMILY = 'Vazirmatn';

/** پرچم «فونت یک بار با موفقیت بار شده، پس احتمالاً در کش است». */
export const APP_FONT_CACHED_KEY = 'gold-font-cached';

const UNICODE_RANGE =
  'U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF, U+200C-200F, U+2212, U+00AB, U+00BB, U+060C, U+061B, U+061F';

function fontApiAvailable(): boolean {
  return typeof FontFace !== 'undefined' && typeof document !== 'undefined' && 'fonts' in document;
}

function createAppFontFace(): FontFace {
  return new FontFace(APP_FONT_FAMILY, `url(${APP_FONT_URL}) format('woff2-variations')`, {
    weight: '100 900',
    style: 'normal',
    display: 'swap',
    unicodeRange: UNICODE_RANGE,
  });
}

function markCached(): void {
  try {
    localStorage.setItem(APP_FONT_CACHED_KEY, '1');
  } catch {
    // بدون localStorage فقط دفعه‌ی بعد هم مسیر «بار اول» طی می‌شود
  }
}

export function isAppFontLikelyCached(): boolean {
  try {
    return localStorage.getItem(APP_FONT_CACHED_KEY) === '1';
  } catch {
    return false;
  }
}

/** مسیر «بارهای بعد»: ثبت و بار فوری. شکست بی‌صداست (فونت سیستم می‌ماند). */
export function applyAppFontNow(): Promise<void> {
  if (!fontApiAvailable()) return Promise.resolve();
  const face = createAppFontFace();
  document.fonts.add(face);
  return face
    .load()
    .then(markCached)
    .catch(() => undefined);
}

/**
 * مسیر «بار اول»: فونت را دانلود و آماده می‌کند ولی فقط وقتی `subscribeNextPage`
 * خبر داد (ناوبری بعدی) به سند اضافه‌اش می‌کند. خروجی برای لغو اشتراک است.
 */
export function applyAppFontOnNextPage(subscribeNextPage: (onNextPage: () => void) => () => void): Promise<void> {
  if (!fontApiAvailable()) return Promise.resolve();
  const face = createAppFontFace();
  return face
    .load()
    .then(() => {
      markCached();
      const unsubscribe = subscribeNextPage(() => {
        unsubscribe();
        document.fonts.add(face);
      });
    })
    .catch(() => undefined);
}
