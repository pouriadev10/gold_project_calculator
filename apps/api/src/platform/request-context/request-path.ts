import type { IncomingMessage } from 'node:http';

/**
 * درخواستی که از میان‌افزار سبک Fastify (`middie`) عبور کرده.
 *
 * `middie` پیشوند نصب را از `req.url` **حذف می‌کند**؛ چون Nest میان‌افزار
 * را روی الگوی سراسری سوار می‌کند، `req.url` عملاً همیشه `/` است و مسیر
 * واقعی فقط در `originalUrl` می‌ماند. این رفتار مستند و پایدار است ولی
 * غیرشهودی — اولین نسخه‌ی این میان‌افزار به `req.url` تکیه کرد و نتیجه‌اش
 * این بود که مسیرهای عمومی هم هدر مستأجر می‌خواستند.
 */
export interface MountedRequest extends IncomingMessage {
  readonly originalUrl?: string;
}

/**
 * مسیرهایی که بدون مستأجر هم پاسخ می‌دهند.
 *
 * - `/health` باید بدون هیچ هدری کار کند، وگرنه load balancer نمی‌تواند
 *   به آن تکیه کند.
 * - `/internal/dev/tenants` جایی است که مستأجر **ساخته** می‌شود؛ الزام
 *   داشتن مستأجر برای ساختن اولین مستأجر یک بن‌بست است.
 * - `/auth` مستأجر را از توکن یا بدنه‌ی درخواست می‌گیرد، نه از هدر —
 *   کسی که هنوز وارد نشده هدر مستأجر ندارد که بفرستد. این مسیرها
 *   احراز هویت خودشان را دارند (`JwtAuthGuard` روی آنچه لازم است).
 */
const PUBLIC_PATH_PREFIXES = ['/health', '/internal/dev/tenants', '/auth'] as const;

/**
 * مسیر درخواست، بدون query string.
 *
 * اگر هیچ منبعی مسیر را ندهد، `/` برمی‌گردد — که عمومی نیست، پس نتیجه‌ی
 * پیش‌فرض «مستأجر لازم است» می‌شود. جهت خرابی عمدی است: در بدترین حالت
 * درخواست رد می‌شود، نه اینکه بدون بررسی مستأجر عبور کند.
 */
export function resolveRequestPath(req: MountedRequest): string {
  const raw = req.originalUrl ?? req.url ?? '/';
  const queryStart = raw.indexOf('?');

  return queryStart === -1 ? raw : raw.slice(0, queryStart);
}

/** آیا این مسیر بدون هدر مستأجر هم مجاز است؟ */
export function isPublicPath(path: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
