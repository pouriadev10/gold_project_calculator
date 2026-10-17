import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { SUBMIT_ATTEMPT_STORAGE_PREFIX } from '@/lib/submit-attempt-storage';

/*
 * FE-106a: پیش‌فرض `findBy*`/`waitFor` ِ Testing Library یک ثانیه است. آزمون‌های integration کل
 * برنامه را با routeTree و چانک‌های تنبل رندر می‌کنند و وقتی ۱۴۷ فایل موازی اجرا می‌شوند، اولین رندر
 * گاهی بیش از آن طول می‌کشد — شکست تصادفی بدون هیچ باگی. انتظار فقط تا رسیدن عنصر طول می‌کشد، پس
 * اجرای عادی کند نمی‌شود. (`testTimeout` ِ هر آزمون سقف واقعی است.)
 */
configure({ asyncUtilTimeout: 10_000 });

/**
 * jsdom متد‌های Pointer Capture را پیاده نمی‌کند. `vaul` (Drawer/Bottom Sheet)
 * حتی برای یک کلیک ساده داخل محتوا — نه فقط درگ واقعی — روی `pointerdown`
 * سعی می‌کند `setPointerCapture` صدا بزند؛ بدون این polyfill هر تستی که
 * داخل Drawer کلیک کند با «setPointerCapture is not a function» می‌ترکد.
 */
if (typeof Element.prototype.hasPointerCapture !== 'function') {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.setPointerCapture !== 'function') {
  Element.prototype.setPointerCapture = () => {};
}
if (typeof Element.prototype.releasePointerCapture !== 'function') {
  Element.prototype.releasePointerCapture = () => {};
}

/**
 * برخلاف مرورگر واقعی، `getComputedStyle(el).transform` در jsdom برای
 * عنصر بدون transform صریح `undefined` می‌دهد، نه رشته‌ی `'none'`. کد
 * رهاسازی درگ `vaul` مستقیم `.match()` روی همین مقدار صدا می‌زند؛ بدون
 * این پچ، حتی یک کلیک ساده (نه فقط درگ واقعی) داخل Drawer با خطای
 * «Cannot read properties of undefined (reading 'match')» می‌ترکد.
 */
const originalGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = (element: Element, pseudoElement?: string | null) => {
  const style = originalGetComputedStyle(element, pseudoElement);
  if (!style.transform) {
    Object.defineProperty(style, 'transform', { value: 'none', configurable: true });
  }
  return style;
};

/**
 * FE-100: تلاش ثبت نامطمئن در sessionStorage ِ همان تب می‌ماند تا ترک صفحه گمش نکند. jsdom یک
 * sessionStorage برای کل فایل تست دارد؛ بدون این پاک‌سازی، تلاشی که یک تست نامطمئن رها کرده، فرم
 * تست بعدی را قفل می‌کند. فقط کلیدهای همین پیشوند — بقیه‌ی storage رفتار پیشین را دارد.
 */
afterEach(() => {
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith(SUBMIT_ATTEMPT_STORAGE_PREFIX)) sessionStorage.removeItem(key);
  }
});
