/**
 * کیپد بیرون از هر Dialog/Drawer رندر می‌شود (یک نمونه‌ی سراسری، نه داخل
 * پورتال گفت‌وگو). Radix/vaul با `modal` پیش‌فرض هر کلیک بیرون از محتوای
 * خودشان را «بیرون» حساب می‌کنند و گفت‌وگو را می‌بندند — یعنی بدون این
 * استثنا، ضربه‌زدن روی خودِ کیپد گفت‌وگو را می‌بست (و state فرم را با
 * `resetForm` پاک می‌کرد). `ResponsiveDialog` با همین سلکتور، ضربه‌های
 * داخل کیپد را از تشخیص «بیرون» معاف می‌کند.
 */
export const KEYPAD_ROOT_ATTRIBUTE = 'data-numeric-keypad-root';

/** آیا هدف رویداد داخل خودِ کیپد است؟ برای `onInteractOutside` روی Dialog/Drawer. */
export function isKeypadTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${KEYPAD_ROOT_ATTRIBUTE}]`) !== null;
}

/**
 * FE-085: ظرف اسکرولی (مثلاً بدنه‌ی Bottom Sheet) که برای بالا آوردن فیلد فعال
 * جای کافی نداشت، تا وقتی کیپد باز است این ویژگی و فاصله‌ی پایین اضافه می‌گیرد.
 */
const KEYPAD_SPACE_ATTRIBUTE = 'data-keypad-space';

/** به ته `element` به اندازه‌ی `height` جای اسکرول اضافه می‌کند (یک‌بار). */
export function reserveKeypadSpace(element: HTMLElement, height: number): void {
  if (element.hasAttribute(KEYPAD_SPACE_ATTRIBUTE)) return;
  element.setAttribute(KEYPAD_SPACE_ATTRIBUTE, element.style.paddingBottom);
  element.style.paddingBottom = `calc(${getComputedStyle(element).paddingBottom} + ${height}px)`;
}

/** همه‌ی جاهای رزروشده را به حالت قبل برمی‌گرداند — با بسته شدن کیپد. */
export function releaseKeypadSpace(): void {
  for (const element of document.querySelectorAll<HTMLElement>(`[${KEYPAD_SPACE_ATTRIBUTE}]`)) {
    element.style.paddingBottom = element.getAttribute(KEYPAD_SPACE_ATTRIBUTE) ?? '';
    element.removeAttribute(KEYPAD_SPACE_ATTRIBUTE);
  }
}
