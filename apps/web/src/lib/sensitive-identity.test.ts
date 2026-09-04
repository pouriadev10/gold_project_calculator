import { describe, expect, it } from 'vitest';
import { maskMobileForDisplay, maskNationalIdForDisplay } from './sensitive-identity';

describe('نمایش امن اطلاعات هویتی — FE-058', () => {
  it('بخش میانی موبایل را می‌پوشاند و ارقام را فارسی نمایش می‌دهد', () => {
    const masked = maskMobileForDisplay('09121234567');

    expect(masked).toBe('۰۹۱۲••••۵۶۷');
    expect(masked).not.toContain('1234');
  });

  it('بخش میانی کد ملی را می‌پوشاند', () => {
    const masked = maskNationalIdForDisplay('0012345678');

    expect(masked).toBe('۰۰۱••••۶۷۸');
    expect(masked).not.toContain('2345');
  });

  it('برای مقدار کوتاه نیز مقدار کامل را آشکار نمی‌کند', () => {
    expect(maskNationalIdForDisplay('123')).toBe('••••۱۲۳');
  });
});
