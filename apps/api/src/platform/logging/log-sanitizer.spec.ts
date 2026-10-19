import { describe, expect, it } from 'vitest';
import { maskNationalId, REDACTED, sanitizeLogData, sanitizeLogRecord } from './log-sanitizer';

describe('maskNationalId', () => {
  it('فقط چهار نویسه‌ی آخر را نگه می‌دارد', () => {
    expect(maskNationalId('0012345678')).toBe('******5678');
  });

  it('مقدار کوتاه را کامل می‌پوشاند', () => {
    expect(maskNationalId('1234')).toBe('****');
    expect(maskNationalId('')).toBe('');
  });
});

describe('sanitizeLogData — داده‌ی حساس', () => {
  it.each([
    'password',
    'newPassword',
    'passwordHash',
    'accessToken',
    'refreshToken',
    'authorization',
    'Authorization',
    'cookie',
    'set-cookie',
    'jwtSecret',
    'apiKey',
    'api_key',
    'credentials',
  ])('کلید %s با [REDACTED] جایگزین می‌شود', (key) => {
    expect(sanitizeLogData({ [key]: 'very-sensitive-value' })).toEqual({ [key]: REDACTED });
  });

  it.each(['nationalId', 'national_id', 'nationalCode', 'NATIONAL-CODE', 'codeMelli'])(
    'کلید %s ماسک می‌شود، نه حذف',
    (key) => {
      expect(sanitizeLogData({ [key]: '0012345678' })).toEqual({ [key]: '******5678' });
    },
  );

  it('کد ملی عددی یا bigint هم ماسک می‌شود و null همان null می‌ماند', () => {
    expect(
      sanitizeLogData({ a: { nationalId: 12345678 }, b: { nationalId: 9876543210n }, c: { nationalId: null } }),
    ).toEqual({ a: { nationalId: '****5678' }, b: { nationalId: '******3210' }, c: { nationalId: null } });
  });

  it('کد ملی با شکل غیرمنتظره به‌جای ماسک کامل پنهان می‌شود', () => {
    expect(sanitizeLogData({ nationalId: { value: '0012345678' } })).toEqual({ nationalId: REDACTED });
  });

  it('کلیدی که فقط شبیه است دست نمی‌خورد', () => {
    expect(sanitizeLogData({ footprint: 3, endpoint: '/parties' })).toEqual({ footprint: 3, endpoint: '/parties' });
  });

  it('در هر عمقی، داخل آرایه و شیء تو در تو، اعمال می‌شود', () => {
    const result = sanitizeLogData({
      party: { displayName: 'علی', identity: { nationalId: '0012345678' } },
      sessions: [{ token: 'abc', id: 's1' }],
    });

    expect(result).toEqual({
      party: { displayName: 'علی', identity: { nationalId: '******5678' } },
      sessions: [{ token: REDACTED, id: 's1' }],
    });
    expect(JSON.stringify(result)).not.toContain('0012345678');
    expect(JSON.stringify(result)).not.toContain('abc');
  });
});

describe('sanitizeLogData — شکل مقدار', () => {
  it('bigint رشته می‌شود و Date به ISO', () => {
    expect(
      sanitizeLogData({ amountRial: 12_500_000n, at: new Date('2026-01-02T03:04:05.000Z') }),
    ).toEqual({ amountRial: '12500000', at: '2026-01-02T03:04:05.000Z' });
  });

  it('عدد (مثل مدت درخواست) و boolean دست نمی‌خورند', () => {
    expect(sanitizeLogData({ durationMs: 12.5, ok: true, statusCode: 201 })).toEqual({
      durationMs: 12.5,
      ok: true,
      statusCode: 201,
    });
  });

  it('فیلد undefined نوشته نمی‌شود و در آرایه null می‌شود', () => {
    expect(sanitizeLogData({ a: undefined, b: [undefined, 1] })).toEqual({ b: [null, 1] });
    expect(sanitizeLogData(undefined)).toBeUndefined();
  });

  it('Error فقط نامش را نگه می‌دارد — پیام ممکن است پارامتر کوئری را لو بدهد', () => {
    const error = new TypeError('Failed query: insert ... params: 0012345678');

    expect(sanitizeLogData({ err: error })).toEqual({ err: { name: 'TypeError' } });
  });

  it('ارجاع حلقوی، تابع، symbol، Date نامعتبر و شیء غیرساده امن می‌شوند', () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;

    expect(
      sanitizeLogData({
        circular,
        fn: () => undefined,
        sym: Symbol('x'),
        bad: new Date('invalid'),
        map: new Map([['k', 'v']]),
        bare: Object.create(null) as object,
      }),
    ).toEqual({
      circular: { name: 'loop', self: '[circular]' },
      fn: '[unsupported]',
      sym: '[unsupported]',
      bad: '[unsupported]',
      map: '[unsupported]',
      bare: {},
    });
  });
});

describe('sanitizeLogRecord', () => {
  it('همیشه یک شیء برمی‌گرداند', () => {
    expect(sanitizeLogRecord({ password: 'x', event: 'e' })).toEqual({ password: REDACTED, event: 'e' });
  });
});
