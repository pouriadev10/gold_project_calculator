import { describe, expect, it } from 'vitest';
import {
  InvalidIdempotencyKeyError,
  InvalidIdempotencyRequestError,
  MissingIdempotencyKeyError,
} from './idempotency.errors';
import {
  IDEMPOTENCY_KEY_HEADER,
  readIdempotencyKey,
  requireIdempotencyKey,
} from './idempotency-key';
import { hashIdempotencyRequest } from './request-hash';

describe('idempotency request hash', () => {
  it('ترتیب کلیدهای JSON را نادیده می‌گیرد', () => {
    const first = hashIdempotencyRequest({
      method: 'post',
      path: '/sales/invoices',
      body: { line: { weightMg: '1250', karat: 750 }, partyId: 'party-1' },
    });
    const reordered = hashIdempotencyRequest({
      method: 'POST',
      path: '/sales/invoices',
      body: { partyId: 'party-1', line: { karat: 750, weightMg: '1250' } },
    });

    expect(reordered).toBe(first);
  });

  it('متد و مسیر را بخشی از هویت request می‌داند', () => {
    const request = { body: { note: 'ثبت' }, method: 'POST', path: '/sales' };

    expect(hashIdempotencyRequest({ ...request, path: '/purchase' })).not.toBe(
      hashIdempotencyRequest(request),
    );
  });

  it('مقدار غیر JSON را برای hash رد می‌کند', () => {
    expect(() =>
      hashIdempotencyRequest({ method: 'POST', path: '/sales', body: { amount: 1n } }),
    ).toThrow(InvalidIdempotencyRequestError);
  });
});

describe('Idempotency-Key header', () => {
  it('کلید معتبر را trim می‌کند', () => {
    expect(requireIdempotencyKey('  retry-001  ')).toBe('retry-001');
  });

  it('کلید جاافتاده و header تکراری را رد می‌کند', () => {
    expect(() => requireIdempotencyKey(undefined)).toThrow(MissingIdempotencyKeyError);
    expect(() =>
      readIdempotencyKey({ [IDEMPOTENCY_KEY_HEADER]: ['one', 'two'] }),
    ).toThrow(InvalidIdempotencyKeyError);
  });
});
