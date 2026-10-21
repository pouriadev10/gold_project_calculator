import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError, OfflineError } from './api-error';
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
    [new OfflineError(), 'network'],
    [new Error('unexpected'), 'unknown'],
  ] as const)('خطای اصلی %s را به حالت %s نگاشت می‌کند', (error, kind) => {
    expect(presentApiError(error).kind).toBe(kind);
  });
});

describe('FE-090 — آفلاین', () => {
  it('پیام آفلاین صریح می‌گوید چیزی ثبت یا برای بعد نگه داشته نشد', () => {
    const result = presentApiError(new OfflineError());
    expect(result.title).toBe('اتصال اینترنت قطع است');
    expect(result.message).toContain('هیچ معامله یا عملیات مالی ثبت نمی‌شود');
    expect(result.message).toContain('چیزی برای ارسال بعدی نگه داشته نمی‌شود');
  });
});

describe('M-09 — قاعده‌ی کسب‌وکار سرور', () => {
  it('پیام فارسی سرور را نشان می‌دهد، نه «تغییر هم‌زمان» یا «فیلدها را اصلاح کنید»', () => {
    const presented = presentApiError(
      new ApiError(422, 'BUSINESS_RULE_VIOLATION', 'موجودی کافی نیست: این کالا در انبار نیست', {}, 'req-1'),
    );

    expect(presented).toMatchObject({
      kind: 'business-rule',
      title: 'این عملیات انجام نشد',
      message: 'موجودی کافی نیست: این کالا در انبار نیست',
      requestId: 'req-1',
    });
  });

  it('پیام ناامن، خالی یا بلند جایش را به متن عمومی می‌دهد', () => {
    for (const message of ['syntax error at or near SELECT', '   ', 'x'.repeat(201)]) {
      expect(presentApiError(new ApiError(422, 'BUSINESS_RULE_VIOLATION', message)).message).toBe(
        'این عملیات با قواعد ثبت سازگار نیست. اطلاعات را بررسی کنید.',
      );
    }
  });

  it('۴۰۹ ِ واقعی همچنان «تغییر هم‌زمان» است', () => {
    expect(presentApiError(new ApiError(409, 'CONFLICT', 'x')).kind).toBe('conflict');
  });
});
