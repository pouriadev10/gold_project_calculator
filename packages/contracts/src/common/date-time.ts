import { z } from 'zod';

/**
 * زمان روی سیم همیشه ISO-8601 **با آفست** است.
 *
 * بدون آفست، «۲۰۲۶-۰۳-۲۱T۰۰:۳۰» در تهران و روی سرور دو روز کاری متفاوت است و
 * فاکتور در گزارش روز اشتباه می‌نشیند. تبدیل به تقویم جلالی کار لایه‌ی نمایش
 * است، نه قرارداد — قرارداد همیشه میلادیِ آفست‌دار می‌ماند.
 */
export const isoDateTimeSchema = z.string().datetime({ offset: true });

export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;
