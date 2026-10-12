/**
 * کاری را به بعد از رنگ بعدی مرورگر می‌اندازد — FE-089.
 *
 * React اثرهای (`useEffect`) به‌روزرسانی‌ای که از یک ضربه یا کلید آمده را همگام، پیش از
 * رنگ، اجرا می‌کند؛ پس کار سنگینی مثل رسم دوباره‌ی نمودار در آن اثر، مستقیماً به INP همان
 * ضربه اضافه می‌شود. `requestAnimationFrame` درست پیش از رنگ صدا زده می‌شود و
 * `setTimeout` داخلش اولین فرصت **بعد از** رنگ است — همان الگوی رایج «yield to paint».
 *
 * تابع لغو برمی‌گرداند تا اگر داده‌ی تازه‌تری رسید یا کامپوننت رفت، کار کهنه اجرا نشود.
 */
export function afterNextPaint(callback: () => void): () => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  if (typeof requestAnimationFrame !== 'function') {
    timeout = setTimeout(callback, 0);
    return () => clearTimeout(timeout);
  }
  const frame = requestAnimationFrame(() => {
    timeout = setTimeout(callback, 0);
  });
  return () => {
    cancelAnimationFrame(frame);
    if (timeout !== undefined) clearTimeout(timeout);
  };
}
