/**
 * آیا endpointهای کمکیِ توسعه باید ثبت شوند؟
 *
 * این تنها جای کدبیس است که `process.env` خام خوانده می‌شود و نه
 * `AppConfig` معتبرشده‌ی BE-004 — چون تصمیم باید **پیش از** وجود
 * container تزریق وابستگی گرفته شود: فهرست controllerهای یک ماژول در
 * لحظه‌ی ارزیابی دکوراتور قطعی می‌شود، خیلی زودتر از اینکه Nest بتواند
 * چیزی resolve کند.
 *
 * شرط عمداً «هرچه غیر از production» است، نه «فقط development»:
 *
 * - معیار پذیرش BE-007 درباره‌ی production است: «endpointهای dev در
 *   production قابل دسترسی نباشند».
 * - تست‌ها با `NODE_ENV=test` اجرا می‌شوند؛ با شرط سخت‌گیرانه‌تر اصلاً
 *   نمی‌شد این endpointها را تست کرد.
 *
 * خطر باقی‌مانده این است که `NODE_ENV` در production تنظیم نشود و
 * schema پیش‌فرض `development` بگذارد. پوشش این خطر در ایمیج است:
 * مرحله‌ی runtime در `apps/api/Dockerfile` صریحاً `ENV NODE_ENV=production`
 * دارد، پس هر استقرار مبتنی بر آن ایمیج به‌صورت پیش‌فرض بسته است.
 *
 * یک تعریف مشترک است تا اگر روزی سخت‌گیرتر شد، همه‌ی ماژول‌های dev با
 * هم عوض شوند — نه اینکه یکی‌شان جا بماند.
 */
export function shouldRegisterDevEndpoints(): boolean {
  return process.env.NODE_ENV !== 'production';
}
