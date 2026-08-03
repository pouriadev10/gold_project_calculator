import { describe, expect, it } from 'vitest';
import { DatabaseConnectionError } from './database-connection.error';

describe('DatabaseConnectionError', () => {
  it('پیام علت را در پیام نهایی نگه می‌دارد', () => {
    const error = new DatabaseConnectionError(new Error('connect ECONNREFUSED 127.0.0.1:1'));

    expect(error.message).toBe('اتصال به دیتابیس برقرار نشد: connect ECONNREFUSED 127.0.0.1:1');
  });

  it('علت غیر Error را هم به رشته تبدیل می‌کند', () => {
    const error = new DatabaseConnectionError('timeout');

    expect(error.message).toBe('اتصال به دیتابیس برقرار نشد: timeout');
  });

  it('cause اصلی را برای بازرسی نگه می‌دارد', () => {
    const cause = new Error('boom');

    expect(new DatabaseConnectionError(cause).cause).toBe(cause);
  });

  it('نام کلاس برای instanceof قابل اتکاست', () => {
    expect(new DatabaseConnectionError('x').name).toBe('DatabaseConnectionError');
  });
});
