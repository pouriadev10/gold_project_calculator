import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service';

const service = new PasswordService();

describe('PasswordService', () => {
  it('واقعاً Argon2id تولید می‌کند، نه Argon2i یا Argon2d', async () => {
    // این تست جای ثابتِ `Algorithm.Argon2id` را می‌گیرد که به‌خاطر
    // ambient const enum قابل ارجاع نبود. اگر پیش‌فرض کتابخانه عوض شود،
    // اینجا قرمز می‌شود.
    expect(await service.hash('گذرواژه‌ی نمونه')).toMatch(/^\$argon2id\$/);
  });

  it('رمز درست را تأیید می‌کند', async () => {
    const hashed = await service.hash('رمز-درست-۱۲۳');

    expect(await service.verify(hashed, 'رمز-درست-۱۲۳')).toBe(true);
  });

  it('رمز غلط را رد می‌کند', async () => {
    const hashed = await service.hash('رمز-درست-۱۲۳');

    expect(await service.verify(hashed, 'رمز-غلط')).toBe(false);
  });

  it('دو بار هش کردن یک رمز، دو خروجی متفاوت می‌دهد — نمک تصادفی است', async () => {
    const [first, second] = await Promise.all([service.hash('یکسان'), service.hash('یکسان')]);

    expect(first).not.toBe(second);
    expect(await service.verify(first, 'یکسان')).toBe(true);
    expect(await service.verify(second, 'یکسان')).toBe(true);
  });

  it('هش خراب باعث استثنا نمی‌شود، فقط false می‌دهد', async () => {
    expect(await service.verify('این-یک-هش-معتبر-نیست', 'هرچیزی')).toBe(false);
    expect(await service.verify('', 'هرچیزی')).toBe(false);
  });

  it('رمز خام در خروجی هش دیده نمی‌شود', async () => {
    const plain = 'رمز-بسیار-خاص-و-قابل-تشخیص';

    expect(await service.hash(plain)).not.toContain(plain);
  });
});
