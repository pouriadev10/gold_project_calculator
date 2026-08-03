import { describe, expect, it } from 'vitest';
import { DatabaseConnectionError } from './database-connection.error';
import { createPool } from './connect';

const PASSWORD = 'super-secret-db-password';

/**
 * هیچ سرویسی روی این پورت گوش نمی‌دهد — همیشه ECONNREFUSED می‌دهد
 * و در چند میلی‌ثانیه رد می‌شود، نه بعد از مهلت اتصال.
 */
const UNREACHABLE_URL = `postgresql://gold:${PASSWORD}@127.0.0.1:1/gold`;

describe('createPool — اتصال قطع‌شده', () => {
  it('روی دیتابیس غیرقابل‌دسترس DatabaseConnectionError پرتاب می‌کند', async () => {
    await expect(createPool(UNREACHABLE_URL)).rejects.toBeInstanceOf(DatabaseConnectionError);
  });

  it('پیام خطا واضح است و رمز عبور را افشا نمی‌کند', async () => {
    try {
      await createPool(UNREACHABLE_URL);
      expect.unreachable('باید خطا می‌داد');
    } catch (error) {
      const message = (error as DatabaseConnectionError).message;

      expect(message).toContain('اتصال به دیتابیس برقرار نشد');
      expect(message).not.toContain(PASSWORD);
    }
  });

  it('روی URL نامعتبر هم به همین شکل شکست می‌خورد، نه یک throw خام از pg', async () => {
    await expect(createPool('not-a-postgres-url')).rejects.toBeInstanceOf(DatabaseConnectionError);
  });
});
