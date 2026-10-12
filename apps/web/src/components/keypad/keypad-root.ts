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
