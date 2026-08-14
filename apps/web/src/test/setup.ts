import '@testing-library/jest-dom/vitest';

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
