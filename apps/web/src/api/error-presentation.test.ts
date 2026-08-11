import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from './api-error';
import { presentApiError } from './error-presentation';

describe('presentApiError', () => {
  it('خطای اعتبارسنجی و خطاهای فیلدی امن را برای فرم نگه می‌دارد', () => {
    const result = presentApiError(
      new ApiError(400, 'VALIDATION_ERROR', 'raw', { name: ['نام الزامی است'] }, 'req-100'),
    );

    expect(result).toMatchObject({
      kind: 'validation',
      title: 'اطلاعات واردشده را بررسی کنید',
      fields: { name: ['نام الزامی است'] },
      requestId: 'req-100',
    });
  });

  it('جزئیات ناامن را حتی اگر پاسخ ناسالمی به کلاینت رسید حذف می‌کند', () => {
    const result = presentApiError(
      new ApiError(400, 'VALIDATION_ERROR', 'raw', {
        name: ['syntax error at or near "select"'],
      }),
    );

    expect(result.fields).toEqual({});
    expect(result.message).not.toMatch(/select/i);
  });

  it.each([
    [new ApiError(409, 'CONFLICT', 'raw'), 'conflict'],
    [new ApiError(401, 'UNAUTHORIZED', 'raw'), 'session-expired'],
    [new ApiError(403, 'FORBIDDEN', 'raw'), 'forbidden'],
    [new NetworkError(), 'network'],
    [new Error('unexpected'), 'unknown'],
  ] as const)('خطای اصلی %s را به حالت %s نگاشت می‌کند', (error, kind) => {
    expect(presentApiError(error).kind).toBe(kind);
  });
});
